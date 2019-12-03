# ddb-simple-migrate
change every item in a dynamodb table

## installation

```
yarn
```

The integration tests use docker-compose to manage dynamo tables,
install it [here](https://docs.docker.com/compose/install/). If
you would like to run the integration tests, run this first:

```
docker-compose build
```

## testing

unit tests:

```
yarn test
```

integration tests that serve as examples:

```
docker-compose run test
```

## usage

**important!** It's critical that before migrating a table the table is placed
in On-Demand billing mode (docs on this matter are [here](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html)).
Trying to balance provisioned capacity and throughput for a table in Provisioned
billing mode during a migration like this is terrible and I don't recommend it.

Basic usage is covered by the examples in [`test/examples.ts`](test/examples.ts),
covering one or multiple tables, stream or batch mode, and forcing a migration
on a provisioned table.

### parameter information

* `TableName` the name of the dynamo table
* `region` the AWS region, eg 'us-east-1'
* `filterCb` callback to filter out unneeded items. return true to migrate item
* `cb` async callback to change item before writing back to table. is passed the Item,
  the counts object, and the batchLog function. not called in batch mode. return the changed item.
* `batchCb` async callback to change a batch of items. is passed the Items array, the
  counts object, the batchLog function, the batchWrite function, and the dlq array. only called in
  batch mode. does not return, is responsible for writing changed Items to the table.
* `scanDelay` ms to wait between scan batches, defaults to 0.
* `writeDelay` ms to wait between write batches, defaults to 0.
* `mode` either "batch" or "stream" (default). "stream" calls "cb" for each item in
  the table, while "batch" calls "batchCb" for each scan batch, and expects that "batchWrite" is
  explicitly called.
* `dynamoEndpoint` endpoint for dynamo tables. if not provided, defaults to the AWS
  default endpoint for "region"
* `customCounts` only valid in "batch" mode. initializes each string provided in
  "counts", for keeping track of different values. Prints them at the end.
* `saveDlq` defaults to true. saves dlq to a json file in the current directory,
  including table name, batch requests, and dynamo error. the dlq is also returned from the operation.
* `quiet` defaults to false. when true, silences all log output.
* `force` defaults to false. when true, allows migration on provisioned-mode table.
