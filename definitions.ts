export interface DLQItem {
  TableName: string;
  Requests: AWS.DynamoDB.WriteRequest[];
  Error: Error;
}

export enum Mode {
  Batch = "batch",
  Stream = "stream"
}

export interface Log {
  (message: string);
}

export interface BatchWrite {
  (
    client: AWS.DynamoDB.DocumentClient,
    tableName: string,
    items: any[],
    delay?: number,
    quiet?: boolean
  ): Promise<DLQItem[]>;
}

export interface FilterCb {
  (Item: any, counts: any, log: Log);
}

export interface Cb {
  (Item: any, counts: any, log: Log);
}

export interface BatchCb {
  (
    client: AWS.DynamoDB.DocumentClient,
    batch: any,
    counts: any,
    log: Log,
    batchWrite: BatchWrite
  );
}

export interface Options {
  TableName: string;
  region: string;
  filterCb?: FilterCb;
  cb?: Cb;
  batchCb?: BatchCb;
  scanDelay?: number;
  writeDelay?: number;
  mode?: Mode;
  dynamoEndpoint?: string;
  customCounts?: string[];
  saveDlq?: boolean;
  quiet?: boolean;
}

export interface Counts {
  batch: number;
  totalItems: number;
  migratedItems: number;
  [k: string]: number;
}
