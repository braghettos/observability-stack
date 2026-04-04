FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /autopilot-alert-proxy .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /autopilot-alert-proxy /autopilot-alert-proxy
EXPOSE 8090
ENTRYPOINT ["/autopilot-alert-proxy"]
