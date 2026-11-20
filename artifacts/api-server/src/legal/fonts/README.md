# Licensed converter fonts

The four unmodified Liberation Serif 2.1.0 TTF faces are bundled with the
application so a release does not depend on `/etc/fonts` or a workspace-specific
Nix store path. Liberation Serif at 12 pt remains the authorized fallback.
The accompanying upstream SIL Open Font License 1.1 permits redistribution
with this software; it does not change licensing of generated documents.

Upstream source: https://github.com/liberationfonts/liberation-fonts/tree/2.1.0
License source: https://raw.githubusercontent.com/liberationfonts/liberation-fonts/2.1.0/LICENSE
Binary provenance: unmodified `liberation-fonts` 2.1.0 package provided by
Nixpkgs. The runtime does not need Nix to find these bundled copies.

SHA-256:

| Face | Digest |
| --- | --- |
| LiberationSerif-Regular.ttf | 6052dc6b3310ad99f6206a3b0e33c1c133a2e5413839bfbf0fb955cd697cbdf4 |
| LiberationSerif-Bold.ttf | fcef5305c2f775b0af6838a294e33c403f2b1c0e9334cccb3b5cfb54afce5d07 |
| LiberationSerif-Italic.ttf | f7a665b7df8253406c3d3e444aeb326a7edb3ba65a5ad9e684ef7f908bf9aaf7 |
| LiberationSerif-BoldItalic.ttf | 5b60606fd80783afc64a7dfefd4b0cc287472f6b2a90dae6f66759dabaa98170 |

`scripts/legal-font-env.sh` exports the repository fontconfig file before
starting the server or running read-only readiness. LibreOffice and fontconfig
inherit that exact environment. Keep this directory and config in release
assets even though the server JavaScript is compiled into `dist/index.js`.