# Setting Up the Journey Display on a Raspberry Pi

This guide is simple enough for anyone to follow. We'll get the Pi showing the Journey Display on a screen.

## What You Need

- Raspberry Pi (any version, we use a Pi Zero)
- Power cord for the Pi
- HDMI cable (to connect to a screen/TV)
- Screen or TV to display on
- Internet connection (WiFi or ethernet cable)
- Keyboard and mouse (only needed during setup)

## Step 1: Get the Pi Ready (5 minutes)

1. Plug the power cord into the Pi
2. Wait for it to boot up (about 1 minute)
3. Plug in the HDMI cable to both the Pi and your screen
4. You should see the desktop appear on your screen

## Step 2: Connect to Internet (5 minutes)

**If using WiFi:**
1. Look in the top right corner of the screen
2. Click the WiFi icon
3. Select your WiFi network from the list
4. Type your WiFi password
5. Click "OK"

**If using Ethernet:**
- Just plug in an ethernet cable to the Pi (no settings needed)

## Step 3: Open the Journey Display (2 minutes)

1. Open the web browser (Chromium or Firefox)
2. In the address bar at the top, type: `https://patrick-simpson.github.io/Journey-Display/`
3. Press Enter
4. The Journey Display should now appear on your screen

## Step 4: Make It Start Automatically (10 minutes)

We want the Pi to show the Journey Display every time it starts up.

### 4a. Open Settings

1. Click the Raspberry Pi menu (top left corner)
2. Go to **Preferences** → **Raspberry Pi Configuration**
3. Click the **Display** tab
4. Find "HDMI Safe Mode" and turn it **ON**
5. Click **OK** and **Reboot** when asked

### 4b. Start the Browser on Boot

1. Open a terminal (black window with text)
   - Click Raspberry Pi menu → Accessories → Terminal
2. Type this command (paste it exactly):
   ```
   mkdir -p ~/.config/autostart
   ```
3. Press Enter

4. Type this second command:
   ```
   nano ~/.config/autostart/journey.desktop
   ```
5. Press Enter

6. You'll see a text editor. Copy and paste this exactly:
   ```
   [Desktop Entry]
   Type=Application
   Name=Journey Display
   Exec=chromium-browser --kiosk https://patrick-simpson.github.io/Journey-Display/
   X-GNOME-Autostart-enabled=true
   ```

7. Press **Ctrl + X** to save
8. Press **Y** for yes
9. Press **Enter** to confirm the filename

10. Close the terminal

> If the display doesn't auto-start and you see an error mentioning
> `chromium-browser`, open a terminal and run
> `which chromium-browser || which chromium` to check which name your
> Pi's version actually uses, then use that name in the `Exec=` line
> above instead.

### 4d. Disable Screen Blanking (don't skip this)

Without this, the Pi can go to sleep after a few idle minutes and the
kiosk will show a blank/dark screen even though it's working fine.

1. Raspberry Pi menu → Preferences → Raspberry Pi Configuration → **Display** tab
2. Find **"Screen Blanking"** and set it to **Disable**
3. Click **OK**

### 4e. Test It

1. Reboot the Pi: Click Raspberry Pi menu → Shutdown → Reboot
2. Wait 1-2 minutes
3. The Journey Display should appear automatically on the screen

## Step 5: Adjust the Schedule (Optional)

The Journey Display shows the Awana Check-in Display most of the day, then switches to the Journey video from **6:30 PM to 7:15 PM**.

**Important:** these times live in the **website's own code on GitHub**,
not in a file on the Pi. The Pi always loads the live site at
`https://patrick-simpson.github.io/Journey-Display/` — it does not read
a local copy, so editing a file on the Pi itself (even if one happens
to exist there) won't change what the kiosk shows. To change the times
for real:

1. On any computer, go to
   https://github.com/patrick-simpson/Journey-Display/blob/main/public/src/schedule.js
2. Click the pencil (✏️) icon to edit it directly in the browser
3. Find these two lines near the top:
   ```javascript
   const JOURNEY_START_MINUTES = 18 * 60 + 30; // 6:30 PM
   const JOURNEY_END_MINUTES = 19 * 60 + 15;   // 7:15 PM
   ```
4. Change the times to what you want (in 24-hour format)
5. Click **"Commit changes..."** then **"Commit changes"** to save to `main`
6. Wait about a minute for the site to redeploy (check the repository's
   **Actions** tab for a green checkmark)
7. On the Pi, refresh the browser (press F5)

## Troubleshooting

**The screen is blank or black:**
- Check that the HDMI cable is plugged in firmly on both ends
- Make sure the Pi is plugged in and powered on
- Wait another minute for it to fully boot

**No internet connection:**
- Make sure WiFi is connected (look for the WiFi icon in the top right)
- If using ethernet, make sure the cable is plugged in
- Restart the Pi

**The browser doesn't open automatically:**
- Check that you followed Step 4b exactly
- Make sure there are no typos in the command
- Restart the Pi again

**The Journey video doesn't show:**
- Make sure the time is set correctly on the Pi (check the clock in the top right)
- The video only appears between 6:30 PM and 7:15 PM
- Check that you have an internet connection
- Seeing the word "Journey" on a plain dark screen (not a black/blank
  screen) is normal — it means the week's lesson hasn't resolved yet or
  couldn't load, and the display intentionally shows a placeholder
  instead of a broken video

**I edited the schedule file on the Pi but nothing changed:**
- The schedule lives in the website's code on GitHub, not on the Pi —
  see Step 5 above for the real steps

## That's It!

Your Journey Display is now set up. The Pi will automatically start and show the display whenever you power it on.

**Need help?** Ask someone with the Journey-Display repository access to check the GitHub issues or contact the setup team.
