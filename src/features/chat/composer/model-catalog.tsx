import { NATIVE_MODEL_GROUP } from "@alwith/module-chat/client"
import type { ModelMenuProps } from "@alwith/module-chat/conversation"
import { type ModelCatalogOptions, ModelSettingsAction, presentModelCatalog } from "@alwith/module-chat/desktop"

import { ModelIcon } from "@/components/icons/model-icon"
import { isEnterpriseModel } from "@/features/auth/enterprise-providers"

/** U's addition to the shared model catalog: its enterprise models carry the enterprise mark. */
export const chatCatalog: ModelCatalogOptions = {
  providerIcon: (groupId, apiId) =>
    groupId === "finture-enterprise" || isEnterpriseModel(apiId) ? (
      <ModelIcon provider="alwith-enterprise" />
    ) : undefined
}

/** U's model menu: the shared presentation with its enterprise marks. */
export const chatModelMenu: Pick<ModelMenuProps, "catalog" | "defaultGroup" | "headerAction"> = {
  defaultGroup: NATIVE_MODEL_GROUP,
  catalog: (groups) => presentModelCatalog(groups, chatCatalog),
  headerAction: <ModelSettingsAction />
}
