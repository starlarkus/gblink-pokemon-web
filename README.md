# GBLink_Pokemon_Web

This is a work in progress JavaScript-based web application for **PokemonGB_Online_Trades**, ported from the [original Python implementation](https://github.com/Lorenzooone/PokemonGB_Online_Trades). It allows you to trade Pokémon from your physical Game Boy cartridges directly in the browser using WebUSB.

## Features

- **WebUSB Support**: Connect your Game Boy Link Cable USB adapter directly to Chrome/Edge without installing Python drivers.

- **Gen 1 (Red/Blue/Green/Yellow)**: Not working yet.

- **Gen 2 Support (Gold/Silver/Crystal)**:
    - **International Versions**: Fully working (Pool Trade & 2-Player).
    - **Japanese Versions**: Not tested.
    - **Mail**: Not tested.
- **Multiboot**:
    - **Sending**: Sends the Gen3toGenx multiboot ROM to GBA. Using the Pokemon-Gen3-to-GenX project. https://github.com/Lorenzooone/Pokemon-Gen3-to-Gen-X

- **Gen 3 (Ruby/Sapphire/Emerald/FRLG)**: Not working yet.

## Prerequisites

- **Google Chrome** or **Microsoft Edge** (browsers with WebUSB support).
- A **Game Boy Link Cable to USB Adapter** Using this firmware: https://github.com/starlarkus/gb-link-firmware-reconfigurable
- Game Boy Color Link Cable

## Usage

1. Open the web page in a supported browser.
2. Connect your GB Link Cable USB Adapter to your computer.
3. Click **"Connect USB Device"** and select your adapter.
4. Select your game generation and trade mode.

### Gen 2 Trading (Gold/Silver/Crystal)
- Go to the Pokémon Center Cable Club.
- Select "Start trade".
- Initiate Trade in game.
- For **Pool Trade**: The server will automatically select a Pokémon for you to receive.
- For **2-Player Trade**: Coordinate with another player in the same room.

### Multiboot (GBA)
- Connect your GBA via the link cable with no cartridge inserted.
- Click **"Send Multiboot"** to transfer the multiboot ROM to GBA.

## Safety & Sanity Checks
Like the original project, this web port attempts to includes sanity checks to ensure that data received from other players (or the server) is valid and won't crash your game or corrupt your save.

## Credits
- Based on [PokemonGB_Online_Trades](https://github.com/Lorenzooone/PokemonGB_Online_Trades) by Lorenzooone.
- Ported to JavaScript/WebUSB for easier access.
