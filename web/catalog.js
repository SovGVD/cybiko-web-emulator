/* What the "Get software" list offers: files from cybiko-roms
 * (SITE.files), as they were on the Cybiko CDs. app: files that go on the
 * Cybiko (.cap and .csu installers are unpacked); cart: plug the MP3
 * cartridge in; has: the file that shows it is installed. */
"use strict";
const XCD = "xtreme-cd/";
const CATALOG = [
    { group: "From the MP3 player cartridge's CD" },
    { name: "MP3 player cartridge", what: "MP3 Player, with the cartridge plugged in; add MP3s to its card in Settings",
      app: ["mp3-cartridge/MP3.cap"], cart: true, has: "Mp3Player.app" },

    { group: "Applications (Xtreme Installation CD)" },
    { name: "CyRecord", what: "voice recorder", app: [XCD + "apps/general/CyRecord.cap"], has: "CyRecord.app" },
    { name: "CyTalk", what: "voice messages", app: [XCD + "apps/general/CyTalk.cap"], has: "CyTalk.app" },
    { name: "E-mail", what: "e-mail through the gate", app: [XCD + "apps/general/email.cap"], has: "email.app" },
    { name: "Calculator", app: [XCD + "apps/general/Calculator.app"] },
    { name: "Journal", app: [XCD + "apps/general/Journal.app"] },
    { name: "Notes", app: [XCD + "apps/general/Notes.app"] },
    { name: "Shared", app: [XCD + "apps/general/Shared.app"] },
    { name: "All Access", app: [XCD + "apps/enter/All_Access.app"] },
    { name: "Photo Viewer", app: [XCD + "apps/enter/Photo_Viewer.app"] },
    { name: "Magic Converter", app: [XCD + "apps/educa/Magic_Converter.app"] },
    { name: "Run Reader 2", app: [XCD + "apps/educa/Run_Reader_2.app"] },
    { name: "Scientific Calculator 2", app: [XCD + "apps/educa/Scientific_Calculator_2.app"] },
    { name: "Spanish for the English", app: [XCD + "apps/educa/Spanish_for_the_English.app"] },
    { name: "Study Stools", app: [XCD + "apps/educa/Study_Stools.app"] },
    { name: "Text Editor Pro", app: [XCD + "apps/educa/Text_Editor_Pro.app"] },

    { group: "Games (Xtreme Installation CD)" },
    { name: "CyLandia Castle 2", app: [XCD + "games/action/CyLandia_Castle_2.app"] },
    { name: "Mountaineer", app: [XCD + "games/action/Mountaineer.app"] },
    { name: "Galaxy Race", app: [XCD + "games/arcade/Galaxy_Race.app"] },
    { name: "Petty Intrigues", app: [XCD + "games/arcade/Petty_Intrigues.app"] },
    { name: "Pinball Pro", app: [XCD + "games/arcade/Pinball_Pro.app"] },
    { name: "Dice Extreme", app: [XCD + "games/brain/Dice_Extreme.app"] },
    { name: "Funny Balls", app: [XCD + "games/brain/Funny_Balls.app"] },
    { name: "Gravitation Proclamation", app: [XCD + "games/brain/Gravitation_Proclamation.app"] },
    { name: "Turbinium Tycoon", app: [XCD + "games/brain/Turbinium_Tycoon.app"] },
    { name: "BB2 Thunder Road", app: [XCD + "games/sports/BB2_Thunder_Road.app"] },
    { name: "CyRace 2", app: [XCD + "games/sports/CyRace_2.app"] },
    { name: "Cybiko Superbike", app: [XCD + "games/sports/Cybiko_Superbike.app"] },
];
