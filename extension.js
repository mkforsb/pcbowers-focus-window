import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Meta from "gi://Meta";
import Shell from "gi://Shell";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

const SETTINGS_KEY = "app-settings";

const KeyboardShortcuts = GObject.registerClass(
  {},
  class KeyboardShortcuts extends GObject.Object {
    constructor(params = {}) {
      super(params);
      this.shortcuts = {};

      this.displayConnection = global.display.connect(
        "accelerator-activated",
        (__, action) => {
          const grabber = this.shortcuts[action];
          if (grabber) grabber.callback();
        }
      );
    }

    reset() {
      for (let action in this.shortcuts) {
        this.unbind(action);
      }
    }

    destroy() {
      global.display.disconnect(this.displayConnection);

      for (let action in this.shortcuts) {
        this.unbind(action);
      }

      this.shortcuts = {};
      this.displayConnection = null;
    }

    bind(accelerator, callback) {
      const action = global.display.grab_accelerator(
        accelerator,
        Meta.KeyBindingFlags.NONE
      );

      if (action === Meta.KeyBindingAction.NONE) return;

      const name = Meta.external_binding_name_for_action(action);
      Main.wm.allowKeybinding(name, Shell.ActionMode.ALL);

      this.shortcuts[action] = { name, accelerator, callback };
    }

    unbind(action) {
      const grabber = this.shortcuts[action];

      if (grabber) {
        global.display.ungrab_accelerator(action);
        Main.wm.allowKeybinding(grabber.name, Shell.ActionMode.NONE);
        delete this.shortcuts[action];
      }
    }
  }
);

export default class FocusWindowExtension extends Extension {
  enable() {
    this.appSys = Shell.AppSystem.get_default();
    this.shortcuts = new KeyboardShortcuts();

    this.settings = this.getSettings();

    this.settingsListener = this.settings.connect(
      `changed::${SETTINGS_KEY}`,
      () => {
        this.setupShortcuts(
          this.settings.get_value(SETTINGS_KEY).recursiveUnpack()
        );
      }
    );

    this.setupShortcuts(
      this.settings.get_value(SETTINGS_KEY).recursiveUnpack()
    );
  }

  setupShortcuts(settings) {
    this.shortcuts.reset();

    settings.forEach((setting) => {
      if (setting.keyboardShortcut && setting.applicationToFocus) {
        this.shortcuts.bind(setting.keyboardShortcut, () => {
          try {
            // get application
            const application = this.appSys.lookup_app(
              setting.applicationToFocus
            );
            if (!application) return false;

            // get application windows and filter appropriately
            const appWindows = application.get_windows().filter((window) => {
              if (!setting.titleToMatch) return true;
              if (setting.exactTitleMatch)
                return window.get_title() === setting.titleToMatch;

              if (typeof window.get_title() !== "string") return false;

              return window
                .get_title()
                .toLowerCase()
                .includes(setting.titleToMatch.toLowerCase());
            });

            // get the currently focused window (there may be none)
            const focusedWindow = global.display.get_focus_window()?.get_id();

            // launch the application
            if (!appWindows.length && setting.launchApplication) {
              // launch the application normally
              if (!setting.commandLineArguments) {
                return application.open_new_window(-1);
              }

              // launch the application with the overriden command line arguments
              const context = global.create_app_launch_context(0, -1);
              const newApplication = Gio.AppInfo.create_from_commandline(
                application.get_app_info().get_executable() +
                  " " +
                  setting.commandLineArguments,
                null,
                Gio.AppInfoCreateFlags.NONE
              );

              newApplication.launch([], context);
            }

            // cycle through open windows if there are multiple
            if (appWindows.length > 1) {
              return Main.activateWindow(appWindows[appWindows.length - 1]);
            }

            // Minimize window if it is already focused and there is only 1 window
            if (
              appWindows.length === 1 &&
              focusedWindow === appWindows[0].get_id()
            ) {
              return appWindows[0].minimize();
            }

            // Draw focus to the window if it is not already focused
            if (appWindows.length === 1) {
              return Main.activateWindow(appWindows[0]);
            }

            return false;
          } catch (error) {
            console.error("focus-window: setting trigger failed:", error);
          }
        });
      }
    });
  }

  disable() {
    this.shortcuts.destroy();
    this.settings.disconnect(this.settingsListener);

    this.settingsListener = null;
    this.settings = null;
    this.shortcuts = null;
    this.appSys = null;
  }
}
