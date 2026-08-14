import { extApi } from "./shared";

extApi.action.onClicked.addListener(() => {
  void extApi.sidebarAction.toggle();
});
