export const tableA: AWS.DynamoDB.CreateTableInput = {
  TableName: "tableA",
  BillingMode: "PAY_PER_REQUEST",
  AttributeDefinitions: [
    {
      AttributeName: "Id",
      AttributeType: "S"
    }
  ],
  ProvisionedThroughput: {
    ReadCapacityUnits: 3,
    WriteCapacityUnits: 3
  },
  KeySchema: [
    {
      AttributeName: "Id",
      KeyType: "HASH"
    }
  ]
};

export const tableB: AWS.DynamoDB.CreateTableInput = {
  TableName: "tableB",
  BillingMode: "PAY_PER_REQUEST",
  AttributeDefinitions: [
    {
      AttributeName: "Id",
      AttributeType: "S"
    },
    {
      AttributeName: "Key",
      AttributeType: "S"
    }
  ],
  ProvisionedThroughput: {
    ReadCapacityUnits: 3,
    WriteCapacityUnits: 3
  },
  KeySchema: [
    {
      AttributeName: "Key",
      KeyType: "HASH"
    },
    {
      AttributeName: "Id",
      KeyType: "RANGE"
    }
  ]
};
