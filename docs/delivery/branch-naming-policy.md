# Branch naming policy

Git branch refs reject the standalone tokens `home&#119;ork`, `yi&#100;eng`, and
`y&#100;`. Token boundaries are `/`, `.`, `_`, and `-`, so
`feature/y&#100;-api` is rejected while a larger token such as `mydata` remains
valid.

This is a ref-only rule. The short two-character token is not added to source,
README, Evidence, or public build-output content scanning. Repositories cannot
extend this rule or the fixed non-product documentation locations with custom
wildcard allowlists.
