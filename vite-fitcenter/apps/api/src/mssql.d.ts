declare module "mssql/msnodesqlv8" {
  import type { ConnectionPool } from "mssql"
  const sql: { connect(config: object): Promise<ConnectionPool> }
  export default sql
}
