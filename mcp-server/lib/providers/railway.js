import { httpJson } from "./http.js";
import { DashclawError } from "../util.js";
/**
 * Railway adapter. Unlike the other providers, Railway exposes a single
 * **GraphQL** endpoint (no REST). Auth is `Authorization: Bearer <RAILWAY_TOKEN>`
 * for account/workspace tokens (the V0 default); project tokens would use a
 * `Project-Access-Token` header instead — out of scope for V0.
 *
 * Railway's resource model is project → environment → service → deployment, so a
 * mapping carries a projectId plus optional environmentId/serviceId to scope
 * deployment + log reads.
 */
const ENDPOINT = "https://backboard.railway.com/graphql/v2";
function headers(token) {
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
/** POST a GraphQL query; surface GraphQL `errors` as a clean DashclawError. */
async function gql(token, query, variables) {
    const res = await httpJson(ENDPOINT, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({ query, variables }),
    });
    if (res.errors && res.errors.length > 0) {
        throw new DashclawError(`Railway API error: ${res.errors.map((e) => e.message).join("; ")}`);
    }
    if (!res.data)
        throw new DashclawError("Railway API returned no data.");
    return res.data;
}
export async function listProjects(token) {
    const query = `query projects {
    projects {
      edges {
        node {
          id
          name
          environments { edges { node { id name } } }
          services { edges { node { id name } } }
        }
      }
    }
  }`;
    const data = await gql(token, query, {});
    const edges = (conn) => (Array.isArray(conn?.edges) ? conn.edges : []);
    return (data.projects?.edges ?? []).map((edge) => {
        const p = edge.node;
        return {
            id: p.id,
            name: p.name,
            environments: edges(p.environments).map((e) => ({ id: e.node.id, name: e.node.name })),
            services: edges(p.services).map((e) => ({ id: e.node.id, name: e.node.name })),
        };
    });
}
export async function getProject(token, projectId) {
    const query = `query project($id: String!) {
    project(id: $id) {
      id
      name
      environments { edges { node { id name } } }
      services { edges { node { id name } } }
    }
  }`;
    const data = await gql(token, query, { id: projectId });
    const p = data.project;
    if (!p)
        throw new DashclawError(`Railway project "${projectId}" not found.`);
    const edges = (conn) => (Array.isArray(conn?.edges) ? conn.edges : []);
    return {
        id: p.id,
        name: p.name,
        environments: edges(p.environments).map((e) => ({ id: e.node.id, name: e.node.name })),
        services: edges(p.services).map((e) => ({ id: e.node.id, name: e.node.name })),
    };
}
export async function listDeployments(token, scope, first = 10) {
    const query = `query deployments($input: DeploymentListInput!, $first: Int) {
    deployments(input: $input, first: $first) {
      edges { node { id status createdAt url staticUrl } }
    }
  }`;
    // Railway requires projectId; environmentId/serviceId narrow the result.
    const input = { projectId: scope.projectId };
    if (scope.environmentId)
        input.environmentId = scope.environmentId;
    if (scope.serviceId)
        input.serviceId = scope.serviceId;
    const data = await gql(token, query, { input, first });
    return (data.deployments?.edges ?? []).map((e) => ({
        id: e.node.id,
        status: e.node.status,
        url: e.node.url ?? undefined,
        staticUrl: e.node.staticUrl ?? undefined,
        createdAt: e.node.createdAt ?? undefined,
    }));
}
export async function getDeploymentLogs(token, deploymentId, limit = 100, startDate) {
    const query = `query deploymentLogs($deploymentId: String!, $limit: Int, $startDate: DateTime) {
    deploymentLogs(deploymentId: $deploymentId, limit: $limit, startDate: $startDate) {
      timestamp
      message
      severity
    }
  }`;
    const data = await gql(token, query, {
        deploymentId,
        limit,
        startDate: startDate ?? null,
    });
    return (data.deploymentLogs ?? []).map((l) => ({
        timestamp: l.timestamp,
        message: l.message,
        severity: l.severity,
    }));
}
/** Trigger a fresh deployment of a service in an environment. Returns its id. */
export async function triggerDeploy(token, scope) {
    const mutation = `mutation environmentTriggersDeploy($input: EnvironmentTriggersDeployInput!) {
    environmentTriggersDeploy(input: $input)
  }`;
    const data = await gql(token, mutation, { input: scope });
    return { deploymentId: data.environmentTriggersDeploy };
}
/** Redeploy an existing deployment by id. */
export async function redeploy(token, deploymentId) {
    const mutation = `mutation deploymentRedeploy($id: String!) {
    deploymentRedeploy(id: $id) { id status }
  }`;
    const data = await gql(token, mutation, {
        id: deploymentId,
    });
    return data.deploymentRedeploy;
}
/** Create or update a variable. Railway triggers a redeploy unless skipDeploys. */
export async function upsertVariable(token, input) {
    const mutation = `mutation variableUpsert($input: VariableUpsertInput!) {
    variableUpsert(input: $input)
  }`;
    await gql(token, mutation, { input });
    return true;
}
//# sourceMappingURL=railway.js.map