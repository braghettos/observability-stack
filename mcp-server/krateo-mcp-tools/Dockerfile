# Multi-stage build for the Krateo MCP Tools server.
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /krateo-mcp-tools .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /krateo-mcp-tools /krateo-mcp-tools
EXPOSE 8001
ENTRYPOINT ["/krateo-mcp-tools"]
