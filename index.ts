import AWS from "aws-sdk";
import { Mode, MigrateParameters, DLQItem } from "./definitions";
import { sleep, batchWrite, Limit } from "./lib";
import uuid from "uuid/v4";
import fs from "fs";

/**
 * Migrate a dynamodb table represented by `TableName` in `region`.
 *
 * A migration in its simplest form is scanning every item in the table,
 * mapping over it and changing it, and writing it back to the table.
 *
 * @param p options
 * @param p.TableName the name of the dynamo table
 * @param p.region the AWS region, eg 'us-east-1'
 * @param p.filterCb callback to filter out unneeded items. return true to migrate item
 * @param p.cb callback to change item before writing back to table. is passed the Item,
 * the counts object, and the batchLog function. not called in batch mode. return the changed item.
 * @param p.batchCb callback to change a batch of items. is passed the Items array, the
 * counts object, the batchLog function, the batchWrite function, and the dlq array. only called in
 * batch mode. does not return, is responsible for writing changed Items to the table.
 * @param p.options.scanDelay ms to wait between scan batches
 * @param p.options.writeDelay ms to wait between write batches
 * @param p.options.mode either "batch" or "stream" (default). "stream" calls "cb" for each item in
 * the table, while "batch" calls "batchCb" for each scan batch, and expects that "batchWrite" is
 * explicitly called.
 * @param p.options.dynamoEndpoint endpoint for dynamo tables. if not provided, defaults to the AWS
 * default endpoint for "region"
 * @param p.options.customCounts only valid in "batch" mode. initializes each string provided in
 * "counts", for keeping track of different values. Prints them at the end.
 * @param p.options.saveDlq defaults to true. saves dlq to a json file in the current directory,
 * including table name, batch requests, and dynamo error.
 */
export default async ({
  TableName,
  region,
  filterCb = () => true,
  cb = () => {
    throw new Error(`cb must be overridden in stream mode`);
  },
  batchCb = () => {
    throw new Error(`batchCb must be overridden in batch mode`);
  },
  options = {
    scanDelay: 0,
    writeDelay: 0,
    mode: Mode.Stream,
    dynamoEndpoint: "",
    customCounts: [],
    saveDlq: true
  }
}: MigrateParameters) => {
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
  options.customCounts.forEach(custom => {
    counts[custom] = 0;
  });

  console.log("...preparing to run with these settings:");
  console.log(JSON.stringify({ TableName, region, ...options }, null, 2));
  console.log("...waiting 5 seconds, press Ctrl-C twice to quit");
  await sleep(5000);

  let LastEvaluatedKey: AWS.DynamoDB.DocumentClient.Key;
  const migrationStartTime = Date.now();
  const dlq: DLQItem[] = [];
  const log = (message: string) => console.log(`${counts.batch}: ${message}`);

  // scan until the table is finished
  do {
    console.log("\n");
    log("starting batch!");

    // delay to keep throughput down
    log(`...sleeping ${options.scanDelay} ms`);
    await sleep(options.scanDelay);

    // read a batch of 25 from the table
    log("scanning from table");
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
    log("scan consumed capacity");
    log(`${batch.ConsumedCapacity.CapacityUnits} RCU`);
    counts.totalItems += batch.Items.length;

    log(`scanned ${batch.Items.length} Items in ${scanTime / 1000} seconds`);
    log(`...filtering`);
    const filtered = batch.Items.filter(item => filterCb(item, counts, log));
    counts.migratedItems += filtered.length;

    log(`migrating ${filtered.length} Items`);

    if (options.mode === Mode.Batch) {
      log("handing control to batch mode callback");
      batchCb(filtered, counts, log, batchWrite);
    } else {
      const Items = filtered.map(item => cb(item, counts, log));

      // write new subscriptions to the table
      log(`writing ${Items.length} Items`);
      await batchWrite(client, TableName, Items, options.writeDelay);
      log("finished writing Items");
    }

    log("finished batch!");
    counts.batch++;
    // continue until scan is finished
  } while (LastEvaluatedKey !== undefined);

  // write dlq to local file for later writing
  if (options.saveDlq && dlq.length > 0) {
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
