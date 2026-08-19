module github.com/rictaworks/questboard

// go ディレクティブは stdlib の最低要求バージョンとして脆弱性照合に使われる（osv-scanner）。
// src/sync-server/go.mod と揃えてパッチ版を宣言する。
go 1.25.13
