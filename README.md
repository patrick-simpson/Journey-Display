# Journey Display

A simple kiosk website that displays the **Journey: Advocates** video lesson on a screen during Awana meetings, with automatic fallback to the Awana Check-in Display the rest of the day.

- **6:30 PM – 7:15 PM:** Shows the current week's Journey lesson video
- **All other times:** Shows the Awana Check-in Display
- **Runs on:** Raspberry Pi (any model, including Pi Zero)
- **No setup complexity:** Plain HTML/CSS/JavaScript—no build step, no databases

**Live site:** https://patrick-simpson.github.io/Journey-Display/

---

## Quick Start: Complete Pi Setup from Scratch

This guide takes you from an unboxed Raspberry Pi to a working Journey Display. **Anyone can follow this—no technical experience needed.**

### What You'll Need

- Raspberry Pi (Pi 4 recommended, but Pi Zero works fine)
- Power supply for your Pi
- MicroSD card (16GB or larger recommended)
- Card reader to write the MicroSD card
- HDMI cable (for connecting to a screen/TV)
- Screen or TV
- Keyboard and mouse (only needed during setup, ~30 minutes)
- Internet connection (WiFi or ethernet cable)

---

## Part 1: Install Raspberry Pi OS on the MicroSD Card (15 minutes)

### Step 1: Download Raspberry Pi Imager

1. Go to https://www.raspberrypi.com/software/
2. Download **Raspberry Pi Imager** for your computer (Windows, Mac, or Linux)
3. Install it like any other program

### Step 2: Write the OS to the MicroSD Card

1. Insert your MicroSD card into your computer's card reader
2. Open **Raspberry Pi Imager**
3. Click **"Choose Device"** → select your Pi model (if unsure, pick **"Raspberry Pi 4"** or **"Raspberry Pi 5"**)
4. Click **"Choose OS"** → select **"Raspberry Pi OS"** (the first option, "Raspberry Pi OS (32-bit)" is fine)
5. Click **"Choose Storage"** → select your MicroSD card (⚠️ **be careful** — this will erase it)
6. Click **"Edit Settings"** (gear icon) to configure WiFi:
   - Check **"Set hostname"** and change it to `journey-pi`
   - Check **"Set username and password"** 
     - Username: `pi`
     - Password: (choose something you remember)
   - Check **"Configure wireless LAN"** 
     - SSID: (your WiFi network name)
     - Password: (your WiFi password)
     - Wireless LAN country: (your country)
   - Check **"Set locale settings"**
     - Time zone: (select your time zone)
   - Click **"Save"**
7. Click **"Write"** (this takes 5-10 minutes)
8. When done, eject the MicroSD card and remove it from your computer

### Step 3: Boot Up the Pi

1. Insert the MicroSD card into the Pi (it's a small slot on the back)
2. Plug the HDMI cable into both the Pi and your screen
3. Plug in the power cable
4. Wait 2-3 minutes for the Pi to start up
5. You should see the desktop on your screen

---

## Part 2: Set Up the Journey Display (5 minutes)

### Step 1: Open a Web Browser

1. On the Pi, look for a web browser icon (usually looks like a compass or globe)
2. Click it to open the browser
3. In the address bar at the top, type:
   ```
   https://patrick-simpson.github.io/Journey-Display/
   ```
4. Press **Enter**
5. The Journey Display should now appear

**That's it!** The display is now running.

### Step 2: Make It Start Automatically on Boot (10 minutes)

You want the Pi to open the Journey Display every time you power it on, without having to click anything.

#### Open a Terminal

1. Right-click on the desktop (the empty part of the screen)
2. Click **"Open Terminal Here"**
3. A black window will open with white text

#### Create the Auto-Start File

Copy and paste this command exactly into the terminal:

```bash
mkdir -p ~/.config/autostart
```

Press **Enter**.

Then type this command:

```bash
nano ~/.config/autostart/journey.desktop
```

Press **Enter**. A text editor will open.

#### Paste the Configuration

Copy this text **exactly** (it's important):

```
[Desktop Entry]
Type=Application
Name=Journey Display
Exec=chromium-browser --kiosk https://patrick-simpson.github.io/Journey-Display/
X-GNOME-Autostart-enabled=true
```

Paste it into the editor (right-click → Paste, or Ctrl+Shift+V).

#### Save and Exit

1. Press **Ctrl + X**
2. Press **Y** (for "yes")
3. Press **Enter** (to keep the filename)
4. Close the terminal

#### Also Disable Screen Blanking (important — don't skip this)

Raspberry Pi OS puts the screen to sleep after a few minutes with no
keyboard/mouse activity, which the kiosk mostly prevents on its own
while a video is playing — but not during the many hours of the day
it's just quietly showing the Check-in Display. Turn it off:

1. Click the Raspberry Pi menu → Preferences → Raspberry Pi Configuration
2. Click the **"Display"** tab
3. Find **"Screen Blanking"** and set it to **Disable**
4. Click **"OK"** and reboot if asked

#### Reboot to Test

1. Click the Raspberry Pi menu (top left)
2. Click **"Shutdown"**
3. Choose **"Reboot"**
4. Wait 2 minutes
5. The Journey Display should appear automatically on your screen

**Success!** Your Pi now shows the Journey Display every time it boots.

> **Note:** if the display doesn't auto-start and you see an error about
> `chromium-browser` not being found, open a terminal and type
> `which chromium-browser || which chromium` to see which name your
> Raspberry Pi OS version actually uses, then use that name instead in
> the `Exec=` line above.

---

## Part 3: Adjust the Schedule (Optional)

By default, the Journey Display appears from **6:30 PM to 7:15 PM**.
These times live in a file that's part of the **live website** — the
same one your Pi loads from `https://patrick-simpson.github.io/Journey-Display/` —
not a file that lives on the Pi itself. **Editing a local copy on the
Pi won't change anything the kiosk actually shows**, since the kiosk
always loads the deployed site, not a local file. To change the
schedule for real:

1. On any computer (doesn't need to be the Pi), go to
   https://github.com/patrick-simpson/Journey-Display/blob/main/public/src/schedule.js
2. Click the pencil (✏️) icon in the top right to edit the file
   directly in your browser — no need to clone the repository
3. Find these lines near the top:
   ```javascript
   const JOURNEY_START_MINUTES = 18 * 60 + 30; // 6:30 PM
   const JOURNEY_END_MINUTES = 19 * 60 + 15;   // 7:15 PM
   ```
4. Change the numbers:
   - **6:30 PM** = `18 * 60 + 30`
   - **7:15 PM** = `19 * 60 + 15`
   - Use 24-hour time (e.g., **5:30 PM** = `17 * 60 + 30`)
5. Scroll down and click **"Commit changes..."**, then **"Commit
   changes"** again to confirm — this saves directly to `main`
6. Wait about a minute for the site to redeploy (you can watch its
   progress under the repository's **"Actions"** tab — look for a
   green checkmark next to "Deploy to GitHub Pages")
7. On the Pi, refresh the browser (F5) to pick up the new schedule

---

## Troubleshooting

### The screen shows nothing or is black

- Make sure the HDMI cable is plugged in firmly on both ends
- Check that the Pi has power (look for a red light on the Pi board)
- Wait another 2 minutes for the Pi to boot up

### No WiFi connection

- Open a terminal
- Type: `nmtui` and press Enter
- Choose "Activate a connection" and select your WiFi network
- Enter your password if prompted

### The browser doesn't auto-start

- Double-check the auto-start file was created correctly (see Part 2, Step 2)
- Make sure there are no typos in the command
- Reboot the Pi again

### The Journey video doesn't appear

- Check the time on the Pi (look in the top right corner of the screen)
- The video only appears between 6:30 PM and 7:15 PM
- Make sure you have an internet connection
- Wait a minute and refresh the browser (F5)
- If you see the word "Journey" on a plain dark screen instead of a
  video, that's normal and expected — it means this week's lesson
  hasn't been resolved yet, or the video couldn't load, and the display
  is deliberately showing a plain placeholder instead of a broken video
- The video plays at a somewhat lower picture quality than Awana's
  original — that's intentional, not a bug: the Pi Zero isn't powerful
  enough to smoothly play the full-quality version, so each lesson is
  automatically shrunk down to something it can handle before it ever
  reaches the kiosk. Sound stays muted for the very first play after
  the Pi boots (browsers require a tap before allowing autoplay with
  sound) — tap either corner button once and every lesson after that
  plays with sound automatically. The video also always plays through
  once and stops; it never loops.

### I want to change the schedule but editing the file on the Pi didn't work

- The schedule lives in the **live website's** code, not on the Pi —
  see **Part 3** above for the real steps (edit on GitHub, wait for the
  site to redeploy, then refresh the Pi's browser)

### I want to control the Pi remotely (SSH)

If you want to access the Pi from another computer, enable SSH:

1. Click the Raspberry Pi menu → Preferences → Raspberry Pi Configuration
2. Click the **"Interfaces"** tab
3. Enable **"SSH"**
4. Click **"OK"**

Now you can log in from another computer using:
```bash
ssh pi@journey-pi.local
```

---

## What's Actually Running?

The Journey Display is a simple website (HTML/CSS/JavaScript) that:

1. **Checks the current time** on the Pi
2. **Shows the Awana Check-in Display** most of the day (embedded in an iframe)
3. **Switches to the Journey video** from 6:30 PM – 7:15 PM
4. **Caches the video locally** so it plays even if the internet is flaky
5. **Lets you manually toggle** between the two displays with a button in the corner

The video lessons come from the **Journey: Advocates** curriculum hosted by Awana. A nightly GitHub Action automatically detects the current week's lesson from your church's TwoTimTwo calendar and updates `current-lesson.json`.

### How it's Built

- `public/index.html` — the whole app. Two full-viewport layers (Check-in Display iframe, Journey video) are both always mounted; a small script toggles which one is visible.
- `public/src/schedule.js` — the 6:30/7:15 schedule and the manual toggle button's behavior.
- `public/src/style.css` — full-bleed layout and button styling.
- `public/lessons.json` — the fixed week→video map for the 32-week Advocates course.
- `public/current-lesson.json` — which week is "current" right now, refreshed nightly by GitHub Actions.

The site deliberately uses **plain HTML/CSS/JS with no build step** because it runs on a Raspberry Pi Zero (2017 hardware with 512MB RAM). Keeping it lightweight matters more than developer convenience.

For technical details, see [CLAUDE.md](CLAUDE.md).

---

## Questions or Problems?

- Check the **Troubleshooting** section above
- Look at [PI_SETUP.md](PI_SETUP.md) for a quick-reference guide (without the OS installation steps)
- Contact your tech team or open an issue on GitHub

---

## License

This project respects Awana's licensing terms. The church has an active Awana Ministry Membership. Videos are cached locally for internal display only and are never re-shared or publicly rehosted.

Website code: MIT License

---

**Last Updated:** 2026-08-01  
**Made for:** KVB Church Awana
