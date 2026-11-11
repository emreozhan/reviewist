# tree-sitter-java (gömülü dil bilgisi)

`tree-sitter-java.wasm`, [tree-sitter-java](https://github.com/tree-sitter/tree-sitter-java) npm paketinin **0.23.5** sürümünden değiştirilmeden kopyalanmıştır (MIT, bkz. `LICENSE`).

Neden gömülü: npm paketi kurulumda yerel (native) eklenti derlemeye çalışan bir kurulum betiği içerir; Reviewist yalnızca
bu WebAssembly dosyasına ihtiyaç duyar. Dosyayı depoda tutmak, kurulumu ağdan ve derleyiciden bağımsız kılar.

- SHA-256: `4fdeac4ca6ca089f06c6f7e562abcac1733cd465728cc7031ebb73c2019122c4`
- Güncellemek için: yeni sürümün `tree-sitter-java.wasm` dosyasını buraya kopyalayın, bu dosyadaki sürüm ve özeti güncelleyin,
  `npm test` çalıştırın (web-tree-sitter ile ABI uyumu testlerle doğrulanır).
