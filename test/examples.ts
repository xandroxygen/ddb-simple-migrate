import "mocha";
import { expect, use } from "chai";
import * as sinon from "sinon";
import * as sinonChai from "sinon-chai";
import * as AWS from "aws-sdk";
import { tableA } from "./schema";

use(sinonChai);

describe("examples", () => {
  const ddb = new AWS.DynamoDB({
    endpoint: "http://dynamo:8000",
    region: "us-east-1"
  });

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
});
