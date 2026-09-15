# release-sql-audit 提交记录

feat(release-sql-audit): 上线 SQL 风险审查——只读静态扫描 kind=sql 上线项（DROP/TRUNCATE/无 WHERE 的 UPDATE/DELETE 阻塞，DROP COLUMN/缺回滚提示）；三入口 1:1 + 纯读不 bump revision
