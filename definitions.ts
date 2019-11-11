interface DLQItem {
  TableName: string;
  Requests: AWS.DynamoDB.WriteRequest[];
  Error: Error;
}
