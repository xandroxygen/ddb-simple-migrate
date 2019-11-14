import "mocha";
import { expect, use } from "chai";
import * as sinon from "sinon";
import * as sinonChai from "sinon-chai";
import * as AWS from "aws-sdk";
import { batchScan, batchWrite } from "../lib/dynamo";

use(sinonChai);

describe("dynamo helpers", () => {
  let ddb;

  beforeEach(() => {
    ddb = new AWS.DynamoDB.DocumentClient();
  });

  describe("batchScan", () => {
    const stubScan = (overrides = {}) => {
      if (ddb.scan.restore) {
        ddb.scan.restore();
      }

      sinon.stub(ddb, "scan").returns({
        promise: () => ({
          ConsumedCapacity: {
            CapacityUnits: 1
          },
          Items: [],
          ...overrides
        })
      });
    };

    beforeEach(() => {
      stubScan();
    });

    afterEach(() => {
      ddb.scan.restore();
    });

    it("calls scan with table name", async () => {
      await batchScan(ddb, "table", undefined);
      expect(ddb.scan).to.have.been.calledWith(
        sinon.match({ TableName: "table" })
      );
    });

    it("returns items from the table", async () => {
      stubScan({ Items: ["an-item"] });
      const { Items } = await batchScan(ddb, "table", undefined);
      expect(Items).to.contain("an-item");
    });

    it("passes LastEvaluatedKey to scan", async () => {
      await batchScan(ddb, "table", { Id: "LastEvaluatedKey" });
      expect(ddb.scan).to.have.been.calledWith(
        sinon.match({ ExclusiveStartKey: { Id: "LastEvaluatedKey" } })
      );
    });

    it("returns LastEvaluatedKey from scan", async () => {
      stubScan({ LastEvaluatedKey: { Id: "LastEvaluatedKey" } });
      const { LastEvaluatedKey } = await batchScan(ddb, "table", undefined);
      expect(LastEvaluatedKey).to.eql({ Id: "LastEvaluatedKey" });
    });
  });

  describe("batchWrite", () => {
    const stubBatchWrite = (overrides = {}) => {
      if (ddb.batchWrite.restore) {
        ddb.batchWrite.restore();
      }

      sinon.stub(ddb, "batchWrite").returns({
        promise: () => ({
          ConsumedCapacity: [{ CapacityUnits: 1 }],
          ...overrides
        })
      });
    };

    beforeEach(() => {
      stubBatchWrite();
    });

    afterEach(() => {
      ddb.batchWrite.restore();
    });

    it("passes items to batchWrite", async () => {
      const Items = [{ Id: 1 }];
      await batchWrite(ddb, "table", Items, 0);
      expect(ddb.batchWrite).to.have.been.calledWith(
        sinon.match({
          RequestItems: { table: Items.map(Item => ({ PutRequest: { Item } })) }
        })
      );
    });

    it("calls batchWrite until queue is empty", async () => {
      const Items = Array.from(Array(26).keys(), (_, i) => ({ Id: i }));
      await batchWrite(ddb, "table", Items, 0);
      expect(ddb.batchWrite).to.have.been.calledTwice;
    });

    it("pushes batch onto dlq when dynamo errors", async () => {
      const error = new Error("an error");
      ddb.batchWrite.restore();
      sinon.stub(ddb, "batchWrite").throws(error);

      const Items = [{ Id: 1 }];
      const dlq = await batchWrite(ddb, "table", Items, 0);
      expect(dlq.length).to.equal(1);
      expect(dlq[0]).to.include({
        TableName: "table",
        Error: error
      });
    });
  });
});
