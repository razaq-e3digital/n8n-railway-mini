FROM n8nio/n8n:2.31.7

# The base image already runs as node. Declaring it explicitly keeps the
# container non-root and clears Trivy DS-0002. Keep this as the last line.
USER node
