import * as AWS from "aws-sdk";
import { DLQItem, BatchWrite, DynamoOptions } from "../definitions";
import { sleep, asyncRetry } from "./util";

export const Limit = 25;

export async function describeTable(TableName: string, options: DynamoOptions) {
  const client = new AWS.DynamoDB(options);
  return client.describeTable({ TableName }).promise();
}

export async function batchScan(
  client: AWS.DynamoDB.DocumentClient,
  tableName: string,
  LastEvaluatedKey: AWS.DynamoDB.DocumentClient.Key,
  quiet: boolean = false
) {
  const log = (message: string) => !quiet && console.log(`  s: ${message}`);

  const scanStartTime = Date.now();
  const batch = await client
    .scan({
      TableName: tableName,
      Limit,
      ReturnConsumedCapacity: "TOTAL",
      ExclusiveStartKey: LastEvaluatedKey
    })
    .promise();
  const scanTime = Date.now() - scanStartTime;

  log("scan consumed capacity");
  log(`${batch.ConsumedCapacity.CapacityUnits} RCU`);
  log(`scanned ${batch.Items.length} Items in ${scanTime / 1000} seconds`);

  return {
    Items: batch.Items,
    LastEvaluatedKey: batch.LastEvaluatedKey
  };
}

/**
 * write Items to TableName in batches of 25
 *
 * * uses a queue to segment into batches
 * * any unprocessed items are put back on the queue
 * * any batches that error are pushed onto the dlq
 *
 * returns any failed batches
 */
export const batchWrite: BatchWrite = async function(
  client: AWS.DynamoDB.DocumentClient,
  tableName: string,
  items: any[],
  delay: number = 0,
  quiet: boolean = false
): Promise<DLQItem[]> {
  let count = 0;
  const dlq: DLQItem[] = [];
  const queue: AWS.DynamoDB.WriteRequest[] = items.map(Item => ({
    PutRequest: { Item }
  }));

  const log = (message: string) =>
    !quiet && console.log(`  w${count}: ${message}`);

  // write the batch until all items have been written
  while (queue.length > 0) {
    log(`... sleeping ${delay} ms`);
    await sleep(delay);

    let dynamoError: Error;
    let batchRequests = queue.splice(0, Limit);

    await asyncRetry(async (retryCount: number) => {
      // retry count starts at 1, only log if there was an actual retry
      if (retryCount > 1) {
        log(`retry ${retryCount}`);
      }

      let unprocessedRequests: AWS.DynamoDB.DocumentClient.BatchWriteItemRequestMap;
      try {
        const writeStartTime = Date.now();
        const result = await client
          .batchWrite({
            RequestItems: { [tableName]: batchRequests },
            ReturnConsumedCapacity: "TOTAL"
          })
          .promise();
        const writeTime = Date.now() - writeStartTime;

        log(
          `consumed ${
            result.ConsumedCapacity[0].CapacityUnits
          } WCU in ${writeTime / 1000} seconds`
        );
        unprocessedRequests = result.UnprocessedItems;
      } catch (e) {
        dynamoError = e;
        return;
      }
      if (unprocessedRequests && unprocessedRequests[tableName]) {
        batchRequests = unprocessedRequests[tableName];
        log(`... retrying ${batchRequests.length} unprocessed items `);
        throw new Error("Unprocessed items added to queue, retry");
      }
    });

    if (dynamoError) {
      log(`Dynamo error during write`);
      log(dynamoError.message);
      log(dynamoError.stack);
      dlq.push({
        TableName: tableName,
        Requests: batchRequests,
        Error: dynamoError
      });
    }

    count++;
  }

  return dlq;
};
