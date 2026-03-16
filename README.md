# Jellyfin DetailsGroupItems Extension

<p align="center">
  <img src="Screenshot.png" alt="Android view" width="520"><br>
</p>


## Fork changes :
- Display ***Worldwide Box Office*** instead of *Domestic Box Office* (with fallback to OMDb Domestic BoxOffice if TMDB Worldwide Box Office is empty)
- Display $9999999 **(Worldwide)** or $9999999 **(Domestic)** accordingly
- Jellyfin Android App external links fix
- Requires OMDb API key **and a TMDB key (free)**

## Adds **Country**, **Awards**, and **Box Office** information to the item details view
- For movies : country of origin, awards information, and box office data.  
- For TV shows : country of origin and awards information

- **Configurable** : Each row can be shown or hidden independently

- Optional: On click external links are resolved automatically by parsing the available provider IDs, ensuring that each row opens the correct destination depending on media type and context.  
country   → IMDb Locations page (imdb.com/title/{imdbId}/locations/)  
awards    → IMDb Awards page or TMDb Awards page (TMDb only for movies, if configured)  
boxoffice → Box Office Mojo page (boxofficemojo.com/title/{imdbId})  

- The order in which the rows appear is fully configurable for movies and TV shows individually.
- Rows that are disabled or removed from the configured order are not rendered and completely removed from the UI.
- The injected rows fully match the appearance and behavior of Jellyfin

---

## Installation

- Intended for **Jellyfin Web**
- Requires a **JavaScript Injector** (or a web browser userscript manager like Violenmonkey)
- Paste the script into the injector
- Don't forget to insert your **OMDb API key** **and a TMDB key (free)** into the script
- Config the scripts optionals to your needs
- Save and reload the Jellyfin Web interface

---

## Tested on

- Windows 11  
- Chrome & Firefox & JMP Windows & Jellyfin Android App
- Jellyfin Web 10.10.7
- Jellyfin Web 10.11.6 compatible

---

## License

MIT
