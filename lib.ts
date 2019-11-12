import promiseRetry from "promise-retry";
import AWS from "aws-sdk";
import { DLQItem } from "./definitions";

export const Limit = 25;
/**
 * write Items to TableName in batches of 25
 *
 * * uses a queue to segment into batches
 * * any unprocessed items are put back on the queue
 * * any batches that error are pushed onto the dlq
 *
 * returns any failed batches
 */
export async function batchWrite(
  client: AWS.DynamoDB.DocumentClient,
  tableName: string,
  items: any[],
  delay: number
): Promise<DLQItem[]> {
  let count = 0;
  const dlq: DLQItem[] = [];
  const queue: AWS.DynamoDB.WriteRequest[] = items.map(Item => ({
    PutRequest: { Item }
  }));

  const log = (message: string) => console.log(`  w${count}: ${message}`);

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
          `consumed ${result.ConsumedCapacity[0].CapacityUnits} WCU in ${writeTime} seconds`
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
}

/**
 * asynchronous sleep function that waits for n milliseconds
 */
export const sleep = async (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));

const DEFAULT_RETRY_OPTIONS = {
  retries: 7,
  factor: 2,
  minTimeout: 1000
};

/**
 * Pass in an async function.
 * `asyncFxn` will be repeatedly called until it either doesn't throw an
 *   error, or `retryOptions.retries` has been reached.
 * The current attempt number will be passed to `asyncFxn`, e.g. for logging
 *   purposes
 * `asyncRetry` will either return successfully or throw the underlying error
 *   if `retryOptions.retries` was reached without success
 * See https://www.npmjs.com/package/promise-retry for info on `retryOptions`.
 *   Basically, it retries with exponential backoff.
 */
export const asyncRetry = async (asyncFxn: Function) => {
  await promiseRetry(async (retry: Function, number: number) => {
    try {
      await asyncFxn(number);
    } catch (err) {
      retry(err);
    }
  }, DEFAULT_RETRY_OPTIONS);
};
