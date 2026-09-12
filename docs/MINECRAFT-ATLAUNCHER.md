# Minecraft + ATLauncher

For Minecraft Java there is no stable game `.exe` to save in ChatPlays. Configure the **Minecraft** control preset and put the launcher path in `EMULADOR_EXE`, for example:

```text
C:\Users\Admin\AppData\Roaming\ATLauncher\ATLauncher.exe
```

On Windows, ChatPlays now:

1. opens or reuses ATLauncher;
2. tries Windows UI Automation to select **Instances**;
3. opens **Instances** and presses **Play**;
4. if those controls are not exposed, captures the ATLauncher window to a **temporary PNG**, uses window-relative fallback positions calibrated from the reference screenshots, then deletes the PNG immediately;
5. waits for the real Minecraft Java process (`javaw.exe` / `java.exe`) and watches that process for crashes instead of watching the launcher.

The Minecraft preset switches the keyboard to **Global** and the mouse to **Game / Minecraft**. The launcher executable is not the game window, so mouse actions focus the running Minecraft window and use relative Windows `SendInput` events instead of absolute cursor repositioning.

If the Windows cursor moves but Minecraft does not turn or click, keep the game visible and do not run it at a higher privilege level than ChatPlays. Also turn **Raw Input** off in Minecraft's mouse settings: raw-input mode can intentionally bypass synthetic Windows mouse events.

## Reference screenshots

- [ATLauncher News page](./minecraft-atlauncher/01-news.png)
- [Instances tab selected](./minecraft-atlauncher/02-instances-selected.png)
- [Instances tab normal](./minecraft-atlauncher/03-instances-normal.png)
- [ATLauncher Instances page](./minecraft-atlauncher/04-instances-page.png)
- [Play button](./minecraft-atlauncher/05-play.png)

These images are repository references. Screenshots captured on a user's PC during fallback are temporary and are not saved in the repository or user data folder.
