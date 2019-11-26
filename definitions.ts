export interface DLQItem {
  TableName: string;
  Requests: AWS.DynamoDB.WriteRequest[];
  Error: Error;
}

export enum Mode {
  Batch = "batch",
  Stream = "stream"
}

export interface FilterCb {
  (Item: any, counts: any, log: Function);
}

export interface Cb {
  (Item: any, counts: any, log: Function);
}

export interface BatchCb {
  (Item: any, counts: any, log: Function, batchWrite: Function);
}

export interface Options {
  scanDelay?: number;
  writeDelay?: number;
  mode?: Mode;
  dynamoEndpoint?: string;
  customCounts?: string[];
  saveDlq?: boolean;
  quiet?: boolean;
}

export interface MigrateParameters {
  TableName: string;
  region: string;
  filterCb?: FilterCb;
  cb?: Cb;
  batchCb?: BatchCb;
  options?: Options;
}
