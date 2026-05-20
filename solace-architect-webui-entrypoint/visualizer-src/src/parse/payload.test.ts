import { describe, expect, it } from "vitest";
import { extractAgentCard, extractStatus, extractTaskId } from "./payload";

describe("extractAgentCard", () => {
  it("returns null when name is missing", () => {
    expect(extractAgentCard({})).toBeNull();
    expect(extractAgentCard(null)).toBeNull();
    expect(extractAgentCard("nope")).toBeNull();
  });

  it("extracts a fully-specified AgentCard", () => {
    const card = extractAgentCard({
      name: "WeatherAgent",
      description: "Provides weather forecasts.",
      defaultInputModes: ["text"],
      defaultOutputModes: ["text", "file"],
      skills: [
        { id: "get_forecast", name: "Get Forecast", description: "Forecast." },
        { id: "bad", name: 42 }, // filtered: name not string
      ],
    });
    expect(card).toEqual({
      name: "WeatherAgent",
      description: "Provides weather forecasts.",
      defaultInputModes: ["text"],
      defaultOutputModes: ["text", "file"],
      skills: [{ id: "get_forecast", name: "Get Forecast", description: "Forecast." }],
    });
  });
});

describe("extractTaskId", () => {
  it("pulls task id from id, params.id, result.id, params.taskId", () => {
    expect(extractTaskId({ id: "t1" })).toBe("t1");
    expect(extractTaskId({ params: { id: "t2" } })).toBe("t2");
    expect(extractTaskId({ result: { id: "t3" } })).toBe("t3");
    expect(extractTaskId({ params: { taskId: "t4" } })).toBe("t4");
    expect(extractTaskId(null)).toBeNull();
  });
});

describe("extractStatus", () => {
  it("pulls status from common JSON-RPC shapes", () => {
    expect(extractStatus({ status: "working" })).toBe("working");
    expect(extractStatus({ result: { status: "completed" } })).toBe("completed");
    expect(extractStatus({ params: { status: "failed" } })).toBe("failed");
    expect(extractStatus({})).toBeNull();
  });
});
