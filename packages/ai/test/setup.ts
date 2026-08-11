import { MODELS } from "../src/models.generated.js";
import { createTestModelCatalog } from "./fixtures/model-catalog.js";

Object.assign(MODELS, createTestModelCatalog());
