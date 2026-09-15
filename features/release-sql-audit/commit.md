# release-sql-audit 提交记录

feat(release-sql-audit): 上线 SQL 风险审查——只读静态扫描 kind=sql 上线项（DROP/TRUNCATE/无 WHERE 的 UPDATE/DELETE 阻塞，DROP COLUMN/缺回滚提示）；三入口 1:1 + 纯读不 bump revision
fix(release-sql-audit): 收口独立测试 D1/D2/D3——注释剥离 / `;` 分段 / `WHERE` 判定收敛为单次词法扫描（字符串字面量里的 where/注释符/分号不再互相污染）；rules 空数组显式拒绝
