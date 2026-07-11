import type { Dashboard } from "../src";

/** A representative dashboard exercising every part of the model. */
export function nodeOverviewDashboard(): Dashboard {
  return {
    apiVersion: "v1",
    kind: "Dashboard",
    metadata: { name: "node-overview" },
    spec: {
      display: {
        name: "Node overview",
        description: "CPU, memory and disk for a node",
      },
      duration: "1h",
      refreshInterval: "30s",
      datasources: {
        prometheus: {
          default: true,
          plugin: { kind: "PrometheusDatasource" },
        },
      },
      variables: [
        {
          kind: "ListVariable",
          spec: {
            name: "instance",
            allowAllValue: true,
            plugin: {
              kind: "PrometheusLabelValuesVariable",
              spec: { labelName: "instance" },
            },
          },
        },
        {
          kind: "TextVariable",
          spec: { name: "cluster", value: "production", constant: true },
        },
      ],
      panels: {
        cpu: {
          kind: "Panel",
          spec: {
            display: { name: "CPU usage" },
            plugin: {
              kind: "TimeSeriesChart",
              spec: { legend: { position: "bottom" } },
            },
            queries: [
              {
                kind: "TimeSeriesQuery",
                spec: {
                  plugin: {
                    kind: "PrometheusTimeSeriesQuery",
                    spec: {
                      query:
                        'rate(node_cpu_seconds_total{instance=~"$instance"}[5m])',
                      seriesNameFormat: "{{cpu}} {{mode}}",
                    },
                  },
                },
              },
            ],
          },
        },
        memory: {
          kind: "Panel",
          spec: {
            display: { name: "Memory available" },
            plugin: { kind: "StatChart", spec: { unit: "bytes" } },
            repeat: { variable: "instance" },
            links: [
              {
                title: "Node detail",
                url: "/d/node-detail?var-instance=$instance&from=$__from&to=$__to",
                targetBlank: true,
              },
            ],
            queries: [
              {
                kind: "TimeSeriesQuery",
                spec: {
                  plugin: {
                    kind: "PrometheusTimeSeriesQuery",
                    spec: {
                      query:
                        'node_memory_MemAvailable_bytes{instance=~"$instance"}',
                    },
                  },
                },
              },
            ],
          },
        },
      },
      layouts: [
        {
          kind: "Grid",
          spec: {
            display: { title: "System" },
            items: [
              {
                x: 0,
                y: 0,
                width: 12,
                height: 8,
                content: { $ref: "#/spec/panels/cpu" },
              },
              {
                x: 12,
                y: 0,
                width: 12,
                height: 8,
                content: { $ref: "#/spec/panels/memory" },
              },
            ],
          },
        },
      ],
    },
  };
}
