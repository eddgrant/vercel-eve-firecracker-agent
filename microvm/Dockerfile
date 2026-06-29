# Root image for the data-analysis microVM sandbox.
#
# This image is turned into a Firecracker ext4 rootfs by ForgeVM
# (`forgevm build-image`), which bakes in forgevm-agent and a custom
# /sbin/init. It must provide:
#   - python3 + pandas  -> for the analysis scripts the agent generates
#   - mount             -> ForgeVM's in-guest init mounts proc/sysfs/devtmpfs
#                          before exec'ing the agent; Debian slim omits mount.
#   - ripgrep (rg)      -> Eve's built-in `grep` tool prefers ripgrep.
# (bash, grep, find, coreutils are already present in the Debian base.)
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends mount ripgrep \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir pandas

# Fail the build early if the essentials aren't present.
RUN python3 -c "import pandas; print('pandas', pandas.__version__)" \
 && command -v mount \
 && command -v python3 \
 && command -v bash \
 && command -v rg
