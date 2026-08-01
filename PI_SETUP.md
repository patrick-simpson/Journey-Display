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

### 4c. Test It

1. Reboot the Pi: Click Raspberry Pi menu → Shutdown → Reboot
2. Wait 1-2 minutes
3. The Journey Display should appear automatically on the screen

## Step 5: Adjust the Schedule (Optional)

The Journey Display shows the Awana Check-in Display most of the day, then switches to the Journey video from **6:30 PM to 7:15 PM**.

If you want to change these times:

1. Open a file manager on the Pi
2. Navigate to: `/home/pi/Journey-Display` (if you cloned it locally)
3. Open `public/src/schedule.js` with a text editor
4. Find these two lines near the top:
   ```javascript
   const JOURNEY_START_MINUTES = 18 * 60 + 30; // 6:30 PM
   const JOURNEY_END_MINUTES = 19 * 60 + 15;   // 7:15 PM
   ```
5. Change the times to what you want (in 24-hour format)
6. Save the file
7. Refresh the browser (press F5)

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

## That's It!

Your Journey Display is now set up. The Pi will automatically start and show the display whenever you power it on.

**Need help?** Ask someone with the Journey-Display repository access to check the GitHub issues or contact the setup team.
