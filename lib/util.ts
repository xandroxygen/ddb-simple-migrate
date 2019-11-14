import * as promiseRetry from "promise-retry";

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
