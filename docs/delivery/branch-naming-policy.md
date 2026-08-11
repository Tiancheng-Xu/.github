# Branch naming policy

Git branch refs reject the standalone tokens `homework`, `yideng`, and `yd`.
Token boundaries are `/`, `.`, `_`, and `-`, so `feature/yd-api` is rejected
while a larger token such as `mydata` remains valid.

This is a ref-only rule. The short `yd` token is not added to source, README,
Evidence, or public build-output content scanning. Repositories cannot extend
this rule or the fixed non-product documentation locations with custom
wildcard allowlists.
