export const tableA = {
  TableName: "tableA",
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

export const tableB = {
  TableName: "tableB",
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
