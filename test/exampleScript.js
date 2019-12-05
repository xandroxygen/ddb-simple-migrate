const { migrate } = require("../dist/index");
const { tableA } = require("./schema");
const { ensureTable, batchWrite } = require("../dist/lib/dynamo");
const AWS = require("aws-sdk");

(async () => {
  const dynamoOptions = {
    region: "us-east-1",
    endpoint: "http://dynamo:8000"
  };
  // populate table with a lot of items
  // this won't usually happen in real life
  await ensureTable(tableA, dynamoOptions);
  const items = [];
  for (let i = 0; i < 1000; i++) {
    items.push({
      Id: `id${i}`,
      Grade: Math.random(),
      Qualified: false
    });
  }
  const client = new AWS.DynamoDB.DocumentClient(dynamoOptions);
  await batchWrite(client, tableA.TableName, items);

  // run a migration that does interesting things
  await migrate({
    TableName: tableA.TableName,
    customCounts: ["overachievers"],
    filterCb: item =>
      // only change items with grade over 0.8
      item.Grade > 0.8,
    cb: (item, counts, log) => {
      // anyone with a grade over 0.95 is an
      // overachiever and we want to track this
      if (item.Grade > 0.95) {
        counts.overachievers += 1;
        log("we found an overachiever!");
      }

      // anyone with a grade over 0.8 is getting
      // upgraded to a 100%!
      item.Grade = 1;
      item.Qualified = true;
      return item;
    },
    dynamoOptions
  });
})();
