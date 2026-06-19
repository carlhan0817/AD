// shared/types/db.ts
// 只读查询能力的最小接口:打分上下文(buildScoringContext/recommend)复用调用方已开的
// DB 连接,而不是每次自开一个新连接 —— node-sqlite3-wasm(纯 WASM)对同一文件被多个
// 连接同时打开的锁语义比原生 sqlite3 严格,长连接 + 短连接并存会报 "database is locked"。
export interface Queryable {
  all(sql: string): unknown[];
}
