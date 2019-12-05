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

```
const { migrate } = require('ddb-simple-migrate')
import { migrate } from 'ddb-simple-migrate'
```

Basic usage is covered by the examples in [`test/examples.ts`](test/examples.ts),
covering one or multiple tables, stream or batch mode, and forcing a migration
on a provisioned table.

### parameter information

* `TableName` the name of the dynamo table
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
* `dynamoOptions` options that are passed to the dynamo client, consists of:
  * `region` the AWS region. defaults to 'us-east-1'
  * `endpoint` for dynamo tables. if not provided, defaults to the AWS default endpoint for "region"
  * `accessKeyId` the AWS access key id, part of AWS credentials
  * `secretAccessKey` the AWS secret access key, part of AWS credentials
* `customCounts` only valid in "batch" mode. initializes each string provided in
  "counts", for keeping track of different values. Prints them at the end.
* `saveDlq` defaults to true. saves dlq to a json file in the current directory,
  including table name, batch requests, and dynamo error. the dlq is also returned from the operation.
* `quiet` defaults to false. when true, silences all log output.
* `force` defaults to false. when true, allows migration on provisioned-mode table.
* `asScript` defaults to true. most of the time, this will be run as part of a node
  script, and needs to listen for Ctrl-C to quit.

## tips

This library tries to migrate your dynamo table at a single-partition scale, to
keep things simple (Partition splits occur at ~1000 WCU or ~3000 RCU, for more
information on partitions see [the docs](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.Partitions.html)).

It scans only batches of 25 items at a time to keep read throughput down. If
for whatever reason the read throughput during the migration gets too close to
3000 RCU, you should stop the migration and introduce a `scanDelay`, generally
between 0-50ms. This is pretty unlikely!

If for whatever reason the write throughput during the migration gets too close
to 1000 WCU (which is more likely), you should stop the migration and start it
again with a `writeDelay`, generally between 0-50 ms. Try starting the migration
over with a delay, and experiment with higher delay times until you find a time
that keeps the throughput low.

### keeping the wcu low

1. Filter out as many items as possible, migrating only the items that absolutely
need it.
2. Introduce a `writeDelay` of a few ms, upping that value until the WCU goes down.
3. If writing to two or more tables, delay the writes to the second table for a
few ms.