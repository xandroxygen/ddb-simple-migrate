import "mocha";
import { expect, use } from "chai";
import * as sinon from "sinon";
import * as sinonChai from "sinon-chai";
import * as AWS from "aws-sdk";
import { tableA } from "./schema";
import migrate from "../index";
import { batchWrite } from "../lib/dynamo";

use(sinonChai);

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
        OtherAttr: "hello"
      }));
      await batchWrite(docClient, tableA.TableName, Items, 0);
    });

    describe("stream mode, one table", () => {
      it("migrates with simple callback", async () => {
        const { counts } = await migrate({
          TableName: tableA.TableName,
          region: config.region,
          cb: Item => ({
            ...Item,
            NewAttr: Item.Id
          }),
          options: {
            dynamoEndpoint: config.endpoint
          }
        });
        expect(counts.migratedItems).to.equal(ItemCount);
      });
    });
  });
});
