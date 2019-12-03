import "mocha";
import { expect } from "chai";
import * as AWS from "aws-sdk";
import { tableA, tableB } from "./schema";
import migrate from "../index";
import { batchWrite } from "../lib/dynamo";
import { Mode } from "../definitions";

describe("examples", () => {
  const config = {
    endpoint: "http://dynamo:8000",
    region: "us-east-1"
  };

  const ddb = new AWS.DynamoDB(config);

  const ensureTable = async schema => {
    try {
      await ddb.describeTable({ TableName: schema.TableName }).promise();
      await ddb.deleteTable({ TableName: schema.TableName }).promise();
      await ddb.createTable(schema).promise();
    } catch (e) {
      await ddb.createTable(schema).promise();
    }
  };

  describe("check dynamo is working", () => {
    beforeEach(async () => {
      await ensureTable(tableA);
    });

    it("created the table correctly", async () => {
      const result = await ddb
        .describeTable({ TableName: tableA.TableName })
        .promise();
      expect(result.Table.TableName).to.equal(tableA.TableName);
    });
  });

  describe("with populated table", () => {
    const docClient = new AWS.DynamoDB.DocumentClient({ service: ddb });
    const ItemCount = 100;

    beforeEach(async () => {
      await ensureTable(tableA);
      const Items = Array.from({ length: ItemCount }, (_, i) => ({
        Id: `id${i}`,
        OtherAttr: i < 50 ? "hello" : "world"
      }));
      await batchWrite(docClient, tableA.TableName, Items, 0, true);
    });

    describe("stream mode, one table", () => {
      it("migrates with simple callback", async () => {
        /**
         * Example 1
         * Simple Stream Migration
         *
         * - item-by-item
         * - no filtering
         * - pointing to local dynamo tables
         * - adds a new attribute based on an existing one
         */
        const { counts } = await migrate({
          TableName: tableA.TableName,
          region: config.region,
          cb: Item => ({
            ...Item,
            NewAttr: `simple${Item.Id}`
          }),
          dynamoEndpoint: config.endpoint
        });
        expect(counts.migratedItems).to.equal(ItemCount);
        expect(counts.totalItems).to.equal(ItemCount);
      });

      it("migrates with filtered items", async () => {
        /**
         * Example 2
         * Filtered Stream Migration
         *
         * - item-by-item
         * - filters out some items based on attributes
         * - pointing to local dynamo tables
         * - adds a new attribute based on an existing one
         */
        const { counts } = await migrate({
          TableName: tableA.TableName,
          region: config.region,
          filterCb: Item => Item.OtherAttr === "hello",
          cb: Item => ({
            ...Item,
            NewAttr: `filter${Item.Id}`
          }),
          dynamoEndpoint: config.endpoint
        });
        expect(counts.migratedItems).to.equal(50);
        expect(counts.totalItems).to.equal(ItemCount);
      });
    });

    describe("batch mode, two tables", () => {
      beforeEach(async () => {
        await ensureTable(tableB);
      });

      it("migrates with batch callback", async () => {
        /**
         * Example 3
         * Batch Migration
         *
         * - gives more control over each batch
         * - better for things like using each batch to write to a second table
         * - batchWrite needs to be called on the given batch, and can be called
         *    on other batches as well
         * - more opportunity to use the counts and logs that are provided
         * - pointing to local dynamo tables
         * - adds a new attribute based on an existing one
         * - adds 2 items to table B for every item in table A
         * - logs actions taken during batch
         */
        const { counts } = await migrate({
          TableName: tableA.TableName,
          region: config.region,
          batchCb: async (client, batch, counts, log, batchWrite) => {
            log("writing batch to table A");
            await batchWrite(client, tableA.TableName, batch);

            log("generating items for B");
            const ItemsForB = [];
            for (const item of batch) {
              ItemsForB.push({ ...item, Key: `lookup1` });
              ItemsForB.push({ ...item, Key: `lookup2` });
            }

            counts.bItems += ItemsForB.length;

            log(`writing ${ItemsForB.length} to table B`);
            await batchWrite(client, tableB.TableName, ItemsForB);
          },
          mode: Mode.Batch,
          dynamoEndpoint: config.endpoint,
          customCounts: ["bItems"]
        });

        expect(counts.bItems).to.equal(2 * counts.totalItems);
      });
    });

    describe("provisioned mode table", () => {
      beforeEach(async () => {
        await ensureTable({ ...tableA, BillingMode: "PROVISIONED" });
        const Items = Array.from({ length: ItemCount }, (_, i) => ({
          Id: `id${i}`,
          OtherAttr: i < 50 ? "hello" : "world"
        }));
        await batchWrite(docClient, tableA.TableName, Items, 0, true);
      });

      it("will throw error if not forced", async () => {
        expect(async () => {
          await migrate({
            TableName: tableA.TableName,
            region: config.region,
            cb: Item => ({
              ...Item,
              NewAttr: `simple${Item.Id}`
            }),
            dynamoEndpoint: config.endpoint
          });
        }).to.throw;
      });

      it("will migrate if forced", async () => {
        /**
         * Example 4
         * Migrating a Provisioned Table
         *
         * It's tricky to balance throughput and capacity
         * when migrating a table in PROVISIONED billing mode.
         * It's not recommended. If you *really* want to do it,
         * pass the `force` option, and may the force be with you.
         */
        const { counts } = await migrate({
          TableName: tableA.TableName,
          region: config.region,
          cb: Item => ({
            ...Item,
            NewAttr: `simple${Item.Id}`
          }),
          dynamoEndpoint: config.endpoint,
          force: true
        });
        expect(counts.migratedItems).to.equal(ItemCount);
        expect(counts.totalItems).to.equal(ItemCount);
      });
    });
  });
});
