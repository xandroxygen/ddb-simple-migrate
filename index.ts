import * as AWS from "aws-sdk";
import { Mode, DLQItem, Counts, Options } from "./definitions";
import { batchWrite, batchScan, describeTable } from "./lib/dynamo";
import { writeFile } from "fs";
import { sleep } from "./lib/util";
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
 * @param p.cb async callback to change item before writing back to table. is passed the Item,
 * the counts object, and the batchLog function. not called in batch mode. return the changed item.
 * @param p.batchCb async callback to change a batch of items. is passed the Items array, the
 * counts object, the batchLog function, the batchWrite function, and the dlq array. only called in
 * batch mode. does not return, is responsible for writing changed Items to the table.
 * @param p.scanDelay ms to wait between scan batches
 * @param p.writeDelay ms to wait between write batches
 * @param p.mode either "batch" or "stream" (default). "stream" calls "cb" for each item in
 * the table, while "batch" calls "batchCb" for each scan batch, and expects that "batchWrite" is
 * explicitly called.
 * @param p.dynamoEndpoint endpoint for dynamo tables. if not provided, defaults to the AWS
 * default endpoint for "region"
 * @param p.customCounts only valid in "batch" mode. initializes each string provided in
 * "counts", for keeping track of different values. Prints them at the end.
 * @param p.saveDlq defaults to true. saves dlq to a json file in the current directory,
 * including table name, batch requests, and dynamo error.
 * @param p.quiet defaults to false. when true, silences all log output.
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
  scanDelay = 0,
  writeDelay = 0,
  mode = Mode.Stream,
  dynamoEndpoint = "",
  customCounts = [],
  saveDlq = true,
  quiet = false,
  force = false
}: Options) => {
  const client = new AWS.DynamoDB.DocumentClient({
    region,
    apiVersion: "2012-08-10",
    endpoint: dynamoEndpoint
  });

  const counts: Counts = {
    batch: 0,
    totalItems: 0,
    migratedItems: 0
  };
  customCounts.forEach(custom => {
    counts[custom] = 0;
  });

  const tableDetails = await describeTable(TableName, region, dynamoEndpoint);
  const isOnDemand =
    tableDetails.Table.BillingModeSummary.BillingMode === "PAY_PER_REQUEST";
  const log = (message: string) => !quiet && console.log(message);

  if (!isOnDemand) {
    log("**WARNING**");
    log("The given table is in PROVISIONED mode, which is not recommended.");

    if (force) {
      log("Since `force: true`, continuing with migration");
    } else {
      log(
        "Ending migration process now - to override this, pass argument `force: true`"
      );
      throw new Error("Table not in On-Demand mode");
    }
  }

  log("...preparing to run with these settings:");
  log(`
    Table          : ${TableName}
    On-Demand?     : ${isOnDemand}
    Region         : ${region}
    Mode           : ${mode}
    Scan Delay     : ${scanDelay}
    Write Delay    : ${writeDelay},
    Custom Counters: ${customCounts},
    Save DLQ?      : ${saveDlq},
    Dynamo Endpoint: ${dynamoEndpoint !== "" ? dynamoEndpoint : "(AWS default)"}
  `);
  log("...waiting 5 seconds, press Ctrl-C twice to quit");
  await sleep(5000);

  let LastEvaluatedKey: AWS.DynamoDB.DocumentClient.Key;
  const migrationStartTime = Date.now();
  const dlq: DLQItem[] = [];
  const batchLog = (message: string) => log(`${counts.batch}: ${message}`);

  // scan until the table is finished
  do {
    log("\n");
    batchLog("starting batch!");

    // delay to keep throughput down
    batchLog(`...sleeping ${scanDelay} ms`);
    await sleep(scanDelay);

    // read a batch of 25 from the table
    batchLog("scanning from table");
    const batch = await batchScan(client, TableName, LastEvaluatedKey, quiet);
    LastEvaluatedKey = batch.LastEvaluatedKey;
    counts.totalItems += batch.Items.length;

    batchLog(`...filtering`);
    const filtered = batch.Items.filter(item =>
      filterCb(item, counts, batchLog)
    );
    counts.migratedItems += filtered.length;

    batchLog(`migrating ${filtered.length} Items`);

    if (mode === Mode.Batch) {
      batchLog("handing control to batch mode callback");
      await batchCb(client, filtered, counts, batchLog, batchWrite);
    } else {
      const Items = await Promise.all(
        filtered.map(item => cb(item, counts, batchLog))
      );

      // write new subscriptions to the table
      batchLog(`writing ${Items.length} Items`);
      const batchDlq = await batchWrite(
        client,
        TableName,
        Items,
        writeDelay,
        quiet
      );
      dlq.push(...batchDlq);
      batchLog("finished writing Items");
    }

    batchLog("finished batch!");
    counts.batch++;
    // continue until scan is finished
  } while (LastEvaluatedKey !== undefined);

  // write dlq to local file for later writing
  if (saveDlq && dlq.length > 0) {
    const d = new Date();
    const dlqPath = `migration.dlq.${d.getFullYear()}${d.getMonth() +
      1}${d.getDate()}${d.getHours}${d.getMinutes()}${d.getSeconds}.json`;

    log(`...writing ${dlq.length} failed batches to '${dlqPath}'`);

    await new Promise(resolve =>
      writeFile(dlqPath, JSON.stringify(dlq, null, 2), resolve)
    );
  }

  const migrationTime = Date.now() - migrationStartTime;

  log("\n\n* Finished migration *\n");
  log(`Failed batches      : ${dlq.length}`);
  log(`Total batches       : ${counts.batch}`);
  log(`Total items scanned : ${counts.totalItems}`);
  log(`Total items migrated: ${counts.migratedItems}`);
  log(`Time spent          : ${migrationTime / 1000}s`);

  if (customCounts.length > 0) {
    log("\n* Custom Counts *");
    customCounts.forEach(custom => {
      log(`"${custom}": ${counts[custom]}`);
    });
  }

  return {
    counts,
    dlq
  };
};
