import { createInstallationRepository } from "@/infrastructure/database/repositories/installation-repository";

import { database } from "./database";

export const installationRepository = createInstallationRepository(database.db);
