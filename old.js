const AWS = require("aws-sdk");
const promiseRetry = require("promise-retry");
const fs = require("fs");
const uuid = require("uuid/v4");

// dynamo batch writes are limited to 25
// also limit scans to 25 to keep consumed capacity down
const Limit = 25;

/**
 * Migrate a dynamodb table represented by `TableName` in `region`.
 *
 * A migration in its simplest form is scanning every item in the table,
 * mapping over it and changing it, and writing it back to the table.
 *
 * @param {*} p
 * @param {String} p.TableName the name of the dynamo table
 * @param {String} p.region the AWS region, eg 'us-east-1'
 * @param {Function} p.filterCb callback to filter out unneeded items. return true to migrate item
 * @param {Function} p.cb callback to change item before writing back to table. is passed the Item,
 * the counts object, and the batchLog function. not called in batch mode. return the changed item.
 * @param {String} p.batchCb callback to change a batch of items. is passed the Items array, the
 * counts object, the batchLog function, the batchWrite function, and the dlq array. only called in
 * batch mode. does not return, is responsible for writing changed Items to the table.
 */
const migrate = async ({
  TableName,
  region,
  filterCb = () => true,
  cb = (Item, counts, batchLog) => {
    throw new Error(`This must be overridden`);
  },
  batchCb = (Items, counts, batchLog, batchWrite, dlq) => {
    throw new Error(`This must be overridden`);
  },
  options = {
    scanDelay: 0,
    writeDelay: 0,
    batchMode: false,
    dynamoEndpoint: "",
    customCounts: []
  }
}) => {
  const client = new AWS.DynamoDB.DocumentClient({
    region,
    apiVersion: "2012-08-10",
    endpoint: options.dynamoEndpoint
  });

  const counts = {
    batch: 0,
    totalItems: 0,
    migratedItems: 0
  };
  customCounts.forEach(custom => {
    counts[custom] = 0;
  });

  const batchLog = message => console.log(`${counts.batch}: ${message}`);

  const migrationStartTime = Date.now();
  let LastEvaluatedKey;
  dlq = [];

  const settings = { TableName, region, ...options };
  console.log("...preparing to run with these settings:");
  console.log(JSON.stringify(settings, null, 2));
  console.log("...waiting 5 seconds, press Ctrl-C twice to quit");
  await sleep(5000);

  // scan until the table is finished
  do {
    console.log("\n");
    batchLog("starting batch!");

    // delay to keep throughput down
    batchLog(`...sleeping ${options.scanDelay} ms`);
    await sleep(options.scanDelay);

    // read a batch of 25 from the table
    batchLog("scanning from table");
    const scanStartTime = Date.now();
    const batch = await client
      .scan({
        TableName,
        Limit,
        ReturnConsumedCapacity: "TOTAL",
        ExclusiveStartKey: LastEvaluatedKey
      })
      .promise();
    const scanTime = Date.now() - scanStartTime;

    LastEvaluatedKey = batch.LastEvaluatedKey;
    batchLog("scan consumed capacity");
    batchLog(`${batch.ConsumedCapacity.CapacityUnits} RCU`);
    counts.totalItems += batch.Items.length;

    batchLog(
      `scanned ${batch.Items.length} Items in ${scanTime / 1000} seconds`
    );
    batchLog(`...filtering`);
    const filtered = batch.Items.filter(item => filterCb(item));
    counts.migratedItems += filtered.length;

    batchLog(`migrating ${filtered.length} Items`);

    if (options.batchMode) {
      batchLog("handing control to batch mode callback");
      batchCb(filtered, counts, batchLog, batchWrite, dlq);
    } else {
      const Items = filtered.map(item => cb(item, counts, batchLog));

      // write new subscriptions to the table
      batchLog(`writing ${Items.length} Items`);
      await batchWrite(client, TableName, Items, options.writeDelay);
      batchLog("finished writing Items");
    }

    // continue until finished
    batchLog("finished batch!");
    counts.batch++;
  } while (LastEvaluatedKey !== undefined);

  // write dlq to local file for later writing
  if (dlq.length > 0) {
    const dlqPath = `migration.dlq.${uuid()}.json`;
    console.log(`...writing ${dlq.length} failed batches to '${dlqPath}'`);
    await new Promise(resolve =>
      fs.writeFile(dlqPath, JSON.stringify(dlq, null, 2), resolve)
    );
  }

  const migrationTime = Date.now() - migrationStartTime;

  console.log("\n\n* Finished migration *\n");
  console.log(`Failed batches      : ${dlq.length}`);
  console.log(`Total batches       : ${counts.batch}`);
  console.log(`Total items scanned : ${counts.totalItems}`);
  console.log(`Total items migrated: ${counts.migratedItems}`);
  console.log(`Time spent          : ${migrationTime / 1000}s`);

  if (options.customCounts.length > 0) {
    console.log("\n* Custom Counts *");
    options.customCounts.forEach(custom => {
      console.log(`"${custom}": ${counts[custom]}`);
    });
  }

  return {
    counts,
    dlq
  };
};

// write Items to TableName in batches of 25
// uses a queue to segment into batches
// any unprocessed items are put back on the queue
// any batches that error are pushed onto the dlq
async function batchWrite(client, TableName, Items, delay) {
  let batchWriteCount = 0;
  const batchWriteLog = message =>
    console.log(`  w${batchWriteCount}: ${message}`);

  const RequestItems = Items.map(Item => ({ PutRequest: { Item } }));
  const queue = [...RequestItems];
  const Limit = 25;

  // write the batch until all items have been written
  while (queue.length > 0) {
    batchWriteLog(`... sleeping ${delay} ms`);
    await sleep(delay);

    let dynamoError;
    let batchRequests = queue.splice(0, Limit);

    await asyncRetry(async retryCount => {
      // retry count starts at 1, only log if there was an actual retry
      if (retryCount > 1) {
        batchWriteLog(`retry ${retryCount}`);
      }
      let unprocessedRequests;
      try {
        const writeStartTime = Date.now();
        const result = await client
          .batchWrite({
            RequestItems: { [TableName]: batchRequests },
            ReturnConsumedCapacity: "TOTAL"
          })
          .promise();
        const writeTime = Date.now() - writeStartTime;

        batchWriteLog(
          `consumed ${result.ConsumedCapacity[0].CapacityUnits} WCU in ${writeTime} seconds`
        );
        unprocessedRequests = result.UnprocessedItems;
      } catch (e) {
        dynamoError = e;
        return;
      }
      if (unprocessedRequests && unprocessedRequests[TableName]) {
        batchRequests = unprocessedRequests[TableName];
        batchWriteLog(
          `... retrying ${batchRequests.length} unprocessed items `
        );
        throw new Error("Unprocessed items added to queue, retry");
      }
    });

    if (dynamoError) {
      batchWriteLog(`Dynamo error during write`);
      batchWriteLog(dynamoError);
      dlq.push({
        TableName,
        batchRequests,
        dynamoError
      });
    }

    batchWriteCount++;
  }
}

const DEFAULT_RETRY_OPTIONS = {
  retries: 7,
  factor: 2,
  minTimeout: 1000
};

// Pass in an async function.
// `asyncFxn` will be repeatedly called until it either doesn't throw an
//   error, or `retryOptions.retries` has been reached.
// The current attempt number will be passed to `asyncFxn`, e.g. for logging
//   purposes
// `asyncRetry` will either return successfully or throw the underlying error
//   if `retryOptions.retries` was reached without success
// See https://www.npmjs.com/package/promise-retry for info on `retryOptions`.
//   Basically, it retries with exponential backoff.
async function asyncRetry(asyncFxn) {
  await promiseRetry(async function(retry, number) {
    try {
      await asyncFxn(number);
    } catch (err) {
      retry(err);
    }
  }, DEFAULT_RETRY_OPTIONS);
}
module.exports = {
  migrate
};
