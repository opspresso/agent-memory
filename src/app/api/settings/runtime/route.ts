import { z } from "zod";

import { InvalidAppSettingsError } from "@/application/settings/manage-app-settings";
import {
  appSettingDefinitions,
  type AppSettingName
} from "@/domain/settings/app-settings";
import { readJsonBody } from "@/lib/json-body";
import {
  appSettingsUseCases,
  applyLiveRuntimeSettingsOverrides,
  invalidateRuntimeSettingsCache
} from "@/lib/runtime-settings";
import { authenticateRequest } from "@/lib/session";

const settingNames = appSettingDefinitions.map(
  (definition) => definition.name
) as [AppSettingName, ...AppSettingName[]];

const updateSchema = z.object({
  reset: z.array(z.enum(settingNames)).optional(),
  values: z.partialRecord(z.enum(settingNames), z.string().max(4_000)).optional()
});

async function authorize(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication;
  }
  if (!authentication.user.isAdmin) {
    return {
      authenticated: false as const,
      response: Response.json(
        { error: "Application settings access denied" },
        { status: 403 }
      )
    };
  }
  return authentication;
}

export async function GET(request: Request) {
  const authentication = await authorize(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  return Response.json(await appSettingsUseCases.getView());
}

export async function PUT(request: Request) {
  const authentication = await authorize(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  const body = await readJsonBody(request);
  if (!body.valid) {
    return body.response;
  }
  const parsed = updateSchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid application settings", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  try {
    const view = await appSettingsUseCases.update(
      parsed.data,
      authentication.user.email
    );
    invalidateRuntimeSettingsCache();
    await applyLiveRuntimeSettingsOverrides();
    return Response.json(view);
  } catch (error) {
    if (error instanceof InvalidAppSettingsError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
