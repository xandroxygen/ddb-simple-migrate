import "mocha";
import { expect } from "chai";
import * as AWS from "aws-sdk";
import { tableA, tableB } from "./schema";
import { migrate } from "../index";
import { batchWrite, ensureTable } from "../lib/dynamo";
import { Mode } from "../definitions";

describe("examples", () => {
  const dynamoOptions = {
    endpoint: "http://dynamo:8000",
    region: "us-east-1"
  };

  describe("check dynamo is working", () => {
    beforeEach(async () => {
      await ensureTable(tableA, dynamoOptions);
    });

    it("created the table correctly", async () => {
      const client = new AWS.DynamoDB(dynamoOptions);
      const result = await client
        .describeTable({ TableName: tableA.TableName })
        .promise();
      expect(result.Table.TableName).to.equal(tableA.TableName);
    });
  });

  describe("with populated table", () => {
    const docClient = new AWS.DynamoDB.DocumentClient(dynamoOptions);
    const ItemCount = 100;

    beforeEach(async () => {
      await ensureTable(tableA, dynamoOptions);
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
          cb: Item => ({
            ...Item,
            NewAttr: `simple${Item.Id}`
          }),
          dynamoOptions
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
          filterCb: Item => Item.OtherAttr === "hello",
          cb: Item => ({
            ...Item,
            NewAttr: `filter${Item.Id}`
          }),
          dynamoOptions
        });
        expect(counts.migratedItems).to.equal(50);
        expect(counts.totalItems).to.equal(ItemCount);
      });
    });

    describe("batch mode, two tables", () => {
      beforeEach(async () => {
        await ensureTable(tableB, dynamoOptions);
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
          dynamoOptions,
          customCounts: ["bItems"]
        });

        expect(counts.bItems).to.equal(2 * counts.totalItems);
      });
    });

    describe("provisioned mode table", () => {
      beforeEach(async () => {
        await ensureTable(
          { ...tableA, BillingMode: "PROVISIONED" },
          dynamoOptions
        );
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

            cb: Item => ({
              ...Item,
              NewAttr: `simple${Item.Id}`
            }),
            dynamoOptions
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
          cb: Item => ({
            ...Item,
            NewAttr: `simple${Item.Id}`
          }),
          dynamoOptions,
          force: true
        });
        expect(counts.migratedItems).to.equal(ItemCount);
        expect(counts.totalItems).to.equal(ItemCount);
      });
    });
  });
});
