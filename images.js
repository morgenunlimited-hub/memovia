// ==========================================================================
// MEMORA — Echte Bilder aus Wikimedia Commons
// Special:FilePath ist eine direkte Redirect-URL, funktioniert im Browser.
// Datei-Namen sind handverlesen, alle existieren in Wikimedia Commons.
// ==========================================================================

const IMAGE_FILES = {
  // === OBST ===
  'Apfel': 'Red_Apple.jpg',
  'Apfel (Frucht)': 'Red_Apple.jpg',
  'Banane': 'Banana_and_cross_section.jpg',
  'Birne': 'Pears.jpg',
  'Birne (Frucht)': 'Pears.jpg',
  'Erdbeere': 'Strawberry_gariguette_DSC03061.JPG',
  'Orange': 'Orange-Whole-%26-Split.jpg',
  'Orange Frucht': 'Orange-Whole-%26-Split.jpg',
  'Zitrone': 'Lemon-edit1.jpg',
  'Limette': 'Limes.jpg',
  'Mandarine': 'Tangerines.JPG',
  'Wassermelone': 'Watermelon_cross_BNC.jpg',
  'Honigmelone': 'Cantaloupes.jpg',
  'Pfirsich': 'Autumn_Red_peaches.jpg',
  'Aprikose': 'Apricot_and_cross_section.jpg',
  'Kirsche': 'Cherry_Stella444.jpg',
  'Kirschen': 'Cherry_Stella444.jpg',
  'Pflaume': 'Plums-Vanier.jpg',
  'Mirabelle': 'Mirabellprunus.jpg',
  'Weintraube': 'Table_grapes_on_white.jpg',
  'Ananas': 'Pineapple_and_cross_section.jpg',
  'Mango': 'Mango_and_cross_section.jpg',
  'Papaya': 'Papaya_cross_section_BNC.jpg',
  'Kokosnuss': 'Coconut_-_whole_and_open.JPG',
  'Kiwi': 'Kiwi_aka.jpg',
  'Kiwifrucht': 'Kiwi_aka.jpg',
  'Himbeere': 'Himbeeren_2018.jpg',
  'Heidelbeere': 'Blueberries_-_28_July_2012.jpg',
  'Brombeere': 'Ripe%2C_ripening%2C_and_green_blackberries.jpg',
  'Johannisbeere': 'Ribes_rubrum_red_currant.jpg',
  'Stachelbeere': 'Gooseberries_(Ribes_uva-crispa).jpg',
  'Quitte': 'Quince_apple_and_pear.jpg',

  // === GEMÜSE ===
  'Karotte': 'Vegetable-Carrot-Bundle-wStalks.jpg',
  'Möhre': 'Vegetable-Carrot-Bundle-wStalks.jpg',
  'Tomate': 'Bright_red_tomato_and_cross_section02.jpg',
  'Kartoffel': 'Patates.jpg',
  'Süßkartoffel': 'Ipomoea_batatas_006.JPG',
  'Gurke': 'Cucumber_and_cross_section.jpg',
  'Zwiebel': 'Onion_on_White.JPG',
  'Schalotte': 'Shallot.JPG',
  'Lauch': 'Leek-bundle.jpg',
  'Knoblauch': 'Garlic.jpg',
  'Paprika': 'Bell_peppers_-_red%2C_green%2C_yellow.jpg',
  'Brokkoli': 'Broccoli_DSC00862.png',
  'Blumenkohl': 'Cauliflower_-_color_variants.jpg',
  'Aubergine': 'Solanum_melongena_24_08_2012_(1).JPG',
  'Zucchini': 'Zucchini-Whole.jpg',
  'Kürbis': 'Pumpkins.jpg',
  'Salat': 'Lettuce_Iceberg-1.jpg',
  'Spinat': 'Bowl_of_baby_spinach.jpg',
  'Echter Spinat': 'Bowl_of_baby_spinach.jpg',
  'Pilz': 'Champignon-MK_(2).jpg',
  'Champignon': 'Champignon-MK_(2).jpg',
  'Mais': 'Maize.jpg',
  'Rettich': 'Daikon_and_white_radishes.jpg',
  'Sellerie': 'Celery.jpg',

  // === TIERE ===
  'Hund': 'Cute_dog.jpg',
  'Haushund': 'Cute_dog.jpg',
  'Katze': 'June_odd-eyed-cat_cropped.jpg',
  'Hauskatze': 'June_odd-eyed-cat_cropped.jpg',
  'Pferd': 'Nokota_Horses_cropped.jpg',
  'Pony': 'Welsh_pony_chestnut.jpg',
  'Kuh': 'Cow_female_black_white.jpg',
  'Hausrind': 'Cow_female_black_white.jpg',
  'Schaf': 'Flock_of_sheep.jpg',
  'Hausschaf': 'Flock_of_sheep.jpg',
  'Schwein': 'Sow_with_piglet.jpg',
  'Hausschwein': 'Sow_with_piglet.jpg',
  'Ziege': 'Domestic_goat_kid_in_capeweed.jpg',
  'Hausziege': 'Domestic_goat_kid_in_capeweed.jpg',
  'Hase': 'Oryctolagus_cuniculus_Tasmania_2.jpg',
  'Kaninchen': 'Oryctolagus_cuniculus_Tasmania_2.jpg',
  'Hauskaninchen': 'Oryctolagus_cuniculus_Tasmania_2.jpg',
  'Maus': 'Apodemus_sylvaticus_bosmuis.jpg',
  'Hausmaus': 'House_mouse.jpg',
  'Esel': 'Donkey_in_Clovelly%2C_North_Devon%2C_England.jpg',
  'Hausesel': 'Donkey_in_Clovelly%2C_North_Devon%2C_England.jpg',
  'Eichhörnchen': 'Sciurus-vulgaris_hernandeangelis_stockholm_2008-06-04.jpg',
  'Eurasisches Eichhörnchen': 'Sciurus-vulgaris_hernandeangelis_stockholm_2008-06-04.jpg',
  'Reh': 'Capreolus_capreolus_2_Jojo.jpg',
  'Hirsch': 'Red_deer_stag_2_(8225415059).jpg',
  'Rothirsch': 'Red_deer_stag_2_(8225415059).jpg',
  'Fuchs': 'Vulpes_vulpes_laying_in_snow.jpg',
  'Rotfuchs': 'Vulpes_vulpes_laying_in_snow.jpg',
  'Wolf': 'Eurasian_wolf_2.jpg',
  'Bär': ['Brown_bear_(Ursus_arctos_arctos)_running.jpg', 'Brown_bear.jpg', 'European_Brown_Bear.jpg'],
  'Braunbär': ['Brown_bear_(Ursus_arctos_arctos)_running.jpg', 'Brown_bear.jpg', 'European_Brown_Bear.jpg'],
  'Eisbär': 'Polar_Bear_-_Alaska.jpg',
  'Wildschwein': 'Sus_Scrofa_(young_male).jpg',
  'Ente': 'Anas_platyrhynchos_male_female_quartet_on_Long_Island_New_York.jpg',
  'Hausente': 'Khaki_Campbell_drake.jpg',
  'Huhn': 'Chicken_lays_an_egg.jpg',
  'Haushuhn': 'Chicken_lays_an_egg.jpg',
  'Gans': 'Greylag_Goose_-Anglesey%2C_Wales-8.jpg',
  'Schwan': 'Mute_swan_Vrhnika.jpg',
  'Truthahn': 'Wild_Turkey-27527-2.jpg',
  'Vogel': 'House_sparrow04.jpg',
  'Fisch': 'Goldfish3.jpg',
  'Forelle': 'Salmo_trutta_fario.jpg',
  'Lachs': ['Atlantic_salmon-1-.jpg', 'Atlantic_salmon.jpg', 'Salmo_salar.jpg'],
  'Atlantischer Lachs': ['Atlantic_salmon-1-.jpg', 'Atlantic_salmon.jpg', 'Salmo_salar.jpg'],
  'Hering': 'Atlantic_herring_(Clupea_harengus).jpg',
  'Karpfen': 'Cyprinus_carpio_GLERL_1.jpg',
  'Schmetterling': 'Vanessa_atalanta_qtl1.jpg',
  'Schmetterlinge': 'Vanessa_atalanta_qtl1.jpg',
  'Biene': 'Apis_mellifera_Western_honey_bee.jpg',
  'Westliche Honigbiene': 'Apis_mellifera_Western_honey_bee.jpg',
  'Hamster': 'Roborovski_dwarf_hamster.jpg',
  'Elefant': 'African_Bush_Elephant.jpg',
  'Elefanten': 'African_Bush_Elephant.jpg',
  'Löwe': 'Lion_waiting_in_Namibia.jpg',
  'Tiger': 'Walking_tiger_female.jpg',
  'Affe': 'Schimpanse_Zoo_Leipzig.jpg',
  'Schimpanse': 'Schimpanse_Zoo_Leipzig.jpg',
  'Gorilla': 'Gorilla_gorilla_gorilla18.jpg',

  // === FAHRZEUGE ===
  'Auto': 'Volkswagen_Golf_VII_5-door_2.0_TDI_BlueMotion_Lounge_(Tornadorot)_-_Heckansicht%2C_29._Juli_2013%2C_M%C3%BCnster.jpg',
  'Fahrrad': 'Bicycle_unicolor.jpg',
  'Motorrad': 'Honda_CB400_Super_Four_002.jpg',
  'Bus': 'Mercedes-Benz_O530_Citaro%2C_BVG.jpg',
  'Omnibus': 'Mercedes-Benz_O530_Citaro%2C_BVG.jpg',
  'Lastwagen': 'MAN_TGX_18.480_truck.jpg',
  'Lastkraftwagen': 'MAN_TGX_18.480_truck.jpg',
  'Zug': 'ICE_3.jpg',
  'Eisenbahn': 'ICE_3.jpg',
  'Straßenbahn': 'M%C3%BCnchner_Tram.jpg',
  'Flugzeug': 'A380_Singapore_Airlines.jpg',
  'Verkehrsflugzeug': 'A380_Singapore_Airlines.jpg',
  'Hubschrauber': 'Eurocopter_EC135.jpg',
  'Schiff': 'Cosco_Container_Ship.jpg',
  'Boot': 'Wooden_rowing_boat.jpg',
  'Yacht': 'Sailboat_yacht.jpg',
  'Fähre': 'StenaHollandicaSailingFromHook.JPG',
  'Traktor': 'Tractor_in_Morocco.jpg',
  'Bagger': 'Cat_385C_excavator.jpg',
  'Roller': 'Vespa_GTS_300_Super.jpg',
  'Wohnmobil': 'Hymer_Tramp_Wohnmobil.jpg',
  'Rakete': 'Saturn_V_launching_Apollo_11.jpg',

  // === MUSIK ===
  'Klavier': 'Steinway_grand_piano%2C_model_D-274%2C_manufactured_at_Steinway%27s_factory_in_Hamburg%2C_Germany.png',
  'Geige': 'Violin_VL100.png',
  'Violine': 'Violin_VL100.png',
  'Cello': 'Cello_front_side.png',
  'Violoncello': 'Cello_front_side.png',
  'Trompete': 'Trumpet_1.jpg',
  'Posaune': 'Trombone.jpg',
  'Gitarre': 'Classical_Guitar_two_views.jpg',
  'Schlagzeug': 'Drum_set.svg',
  'Saxophon': 'Saxofon_zilverkleurig.JPG',
  'Klarinette': 'Clarinet.png',
  'Akkordeon': 'Akkordeon_an_einer_Wand.jpg',
  'Harfe': 'Concert_harp.jpg',
  'Querflöte': 'Western_concert_flute_(Yamaha%2C_nickel).jpg',
  'Flöte': 'Western_concert_flute_(Yamaha%2C_nickel).jpg',

  // === BLUMEN ===
  'Rose': 'Rosa_Precious_platinum_3.jpg',
  'Tulpe': 'Tulipa_-_Rosa.jpg',
  'Sonnenblume': 'A_sunflower.jpg',
  'Margerite': 'Marguerite_du_jardin.jpg',
  'Gänseblümchen': 'Bellis_perennis_white_(aka).jpg',
  'Nelke': 'Schnittblumen_Nelken.jpg',
  'Veilchen': 'Viola_riviniana_001.jpg',
  'Lilie': 'Lilium_Stargazer_2.jpg',
  'Orchidee': 'Orchidea_Mostra_Ascona_2003.jpg',
  'Pfingstrose': 'Paeonia_lactiflora1ROSE.jpg',
  'Narzisse': 'Narcissus_poeticus_recurvus.jpg',
  'Hyazinthe': 'Hyacinthus_orientalis_blue.jpg',
  'Krokus': 'Crocus_vernus.jpg',
  'Lavendel': 'Single_lavender_flower02.jpg',
  'Echter Lavendel': 'Single_lavender_flower02.jpg',

  // === ALLTAG ===
  'Brille': 'Glasses_800_edit.png',
  'Sonnenbrille': 'Sunglasses_aviator_pilot.jpg',
  'Uhr': 'Wristwatch.jpg',
  'Armbanduhr': 'Wristwatch.jpg',
  'Wanduhr': 'Wall_clock.jpg',
  'Wecker': 'Bedside_clock_on_off.jpg',
  'Buch': 'Cs_books.jpg',
  'Heft': 'Spiral_Notebook.jpg',
  'Zeitung': 'Old_book_-_Timeout.jpg',
  'Schlüssel': 'A_house_key.jpg',
  'Schloss': 'Open_padlock.svg',
  'Regenschirm': 'Umbrella_2.jpg',
  'Schirm': 'Umbrella_2.jpg',
  'Hut': ['Felt_hat_in_olive.jpg', 'Black_top_hat.jpg', 'Hat-pierre-cardin.jpg'],
  'Mütze': 'Knit_cap_red.jpg',
  'Stuhl': 'Wooden_chair_(Hovedstadens_M%C3%B8belfabrik).jpg',
  'Hocker': 'Wooden_stool.jpg',
  'Sessel': 'Eames_Lounge_Chair_and_Ottoman.jpg',
  'Tisch': 'Wooden_table.jpg',
  'Schreibtisch': ['Wooden_office_desk.jpg', 'Schreibtisch.jpg', 'Office_desk.jpg'],
  'Bett': ['Bett.jpg', 'Doppelbett.jpg', 'Bedroom_bed.jpg'],
  'Sofa': ['Sofa-modern.jpg', 'Couch_(PSF).jpg', 'Sofa.jpg'],
  'Schrank': ['Wardrobe.jpg', 'Wardrobe_(PSF).jpg', 'Kleiderschrank.jpg'],
  'Kommode': 'Commode_-_French_-_Walters_65189_-_Profile.jpg',
  'Lampe': 'Table_lamp_NIEN_3.jpg',
  'Kerze': 'Brennende_Kerze.jpg',
  'Telefon': 'Western_Electric_model_500_telephone_(7895).jpg',
  'Tasse': 'Tea_cup_with_saucer.jpg',
  'Becher': 'Coffee_mug.jpg',
  'Glas': 'Empty_drinking_glass.jpg',
  'Trinkglas': 'Empty_drinking_glass.jpg',
  'Teller': 'Plate_(food)_-_2.jpg',
  'Schüssel': 'Bowl_with_cracker.jpg',
  'Gabel': 'Silver_fork.jpg',
  'Messer': 'Couteau_de_cuisine.jpg',
  'Küchenmesser': 'Couteau_de_cuisine.jpg',
  'Löffel': 'Spoon.jpg',
  'Topf': 'Stainless_Steel_Pot.jpg',
  'Kochtopf': 'Stainless_Steel_Pot.jpg',
  'Pfanne': 'Frying-pan.jpg',
  'Bratpfanne': 'Frying-pan.jpg',
  'Hammer': 'Claw-hammer.jpg',
  'Säge': 'Crosscut_saw.jpg',
  'Schraubenzieher': 'Slotted_screwdriver.jpg',
  'Schraubendreher': 'Slotted_screwdriver.jpg',
  'Zange': 'Adjustable_pliers.jpg',
  'Bohrer': 'DeWalt_cordless_drill.jpg',
  'Bohrmaschine': 'DeWalt_cordless_drill.jpg',
  'Pinsel': 'Paintbrush.jpg',

  // === NATUR ===
  'Baum': 'Eik_at_M%C3%B8nster%C3%A5s.jpg',
  'Wald': 'Pacific_Spirit_Park_North_Vancouver.jpg',
  'Berg': 'Matterhorn_from_Domh%C3%BCtte_-_2.jpg',
  'Meer': 'Adriatic_Sea_view_Croatia_Maslenica_(1).jpg',
  'See': 'Lake_M%C3%B6hne_in_Germany.jpg',
  'Fluss': 'Rhine_river_at_Boppard.jpg',
  'Sonne': 'The_Sun_by_the_Atmospheric_Imaging_Assembly_of_NASA%27s_Solar_Dynamics_Observatory_-_20100819.jpg',
  'Mond': 'FullMoon2010.jpg',
  'Erdmond': 'FullMoon2010.jpg',
  'Wolke': 'Cumulus_clouds_in_fair_weather.jpeg',
  'Schnee': ['Snow_in_a_pine_tree.jpg', 'Snow_landscape.jpg', 'Frosty_Snow.jpg'],
  'Regen': ['Regen_in_Berlin.jpg', 'Rain_droplets.jpg', 'Heavy_rain.jpg'],
  'Stern': ['Star_alfa_ori-Hubble.jpg', 'Sun_white.jpg', 'Star_polaris.jpg'],
  'Insel': ['Heart_island.jpg', 'Bora_Bora_aerial.jpg', 'Tropical_Island.jpg'],
  'Felsen': ['Externsteine.jpg', 'Externsteine_Detmold.jpg', 'Rock_outcrop.jpg'],
  'Wiese': ['Wildflower_meadow.jpg', 'Field_in_Latvia.jpg', 'Meadow_in_Slovenia.jpg', 'Mountain_meadow_in_Sw_Bohemia.jpg', 'Greens.jpg'],

  // === KLEIDUNG ===
  'Hose': 'Mens_jeans.jpg',
  'Hemd': 'Hemd_blau.jpg',
  'Mantel': 'Mantel.jpg',
  'Jacke': 'Leather_jacket.jpg',
  'Schuh': 'Brown_leather_shoes.jpg',
  'Stiefel': 'Riding_boots.jpg',
  'Pullover': 'Wool_sweater_dark_blue.jpg',
  'Socke': 'Pair_of_socks.jpg',
  'Schal': 'Wool_scarf_red.jpg',
  'Handschuh': 'Pair_of_gloves.jpg',
  'Rock': 'Pleated_skirt_(black).jpg',

  // === ESSEN ===
  'Pizza': ['Pizza-3007395.jpg', 'Pizza_Margherita.jpg', 'Eq_it-na_pizza-margherita_sep2005_sml.jpg'],
  'Roulade (Speise)': ['Rinderroulade.jpg', 'Roulade.jpg', 'Rouladen.jpg'],
  'Roulade': ['Rinderroulade.jpg', 'Roulade.jpg', 'Rouladen.jpg'],
  'Kohlroulade': ['Kohlrouladen.jpg', 'Cabbage_roll.jpg', 'Gef%C3%BCllte_Kohlrouladen.jpg'],
  'Toastbrot': ['Sliced_bread.jpg', 'Toast.jpg', 'Toastbrot.jpg'],
  'Konfitüre': ['Strawberry_jam_on_a_dish.JPG', 'Marmelade.jpg', 'Jam.jpg'],
  'Stulle': ['Butterbrot.jpg', 'Wurstbrot.jpg', 'Sliced_bread.jpg'],
  'Lebkuchen': ['Lebkuchen_-_N%C3%BCrnberger.jpg', 'Lebkuchen.jpg', 'Gingerbread.jpg'],
  'Christstollen': ['Stollen-1.jpg', 'Christstollen.jpg', 'Dresdner_Stollen.jpg'],
  'Waffel': ['Waffles_with_Strawberries.jpg', 'Belgian_waffle.jpg', 'Waffeln.jpg'],
  'Rührei': ['Scrambled_eggs.jpg', 'Scrambled_Eggs.jpg', 'Rampuredegg.jpg'],
  'Spargel': ['Asparagus.jpg', 'Spargel.jpg', 'White_asparagus.jpg'],
  'Rotkohl': ['Red_cabbage.jpg', 'Rotkohl.jpg', 'Rotkraut.jpg'],
  'Kartoffelsalat': ['Kartoffelsalat.jpg', 'Potato_salad.jpg', 'German_potato_salad.jpg'],
  'Tomatensuppe': ['Tomato_soup.jpg', 'Tomatensuppe.jpg', 'Cream_of_tomato_soup.jpg'],
  'Spaghetti': ['Spaghetti_carbonara.jpg', 'Spaghetti_Carbonara.jpg', 'Spaghetti_with_meatballs.jpg'],
  'Nudeln': ['Pasta_2006_4.jpg', 'Pasta.jpg', 'Various_pasta.jpg'],
  'Brot': ['Brot_(cropped).jpg', 'Brot.jpg', 'Vollkornbrot.jpg'],
  'Brötchen': ['Br%C3%B6tchen.jpg', 'Broetchen.jpg', 'German_Brötchen.jpg'],
  'Brezel': ['Lye_pretzel_-_DSC04190.JPG', 'Brezel.jpg', 'Pretzel.jpg'],
  'Toast': ['Sliced_bread.jpg', 'Toast.jpg', 'Toasted_bread.jpg'],
  'Croissant': ['Croissant_(2).jpg', 'Croissant.jpg', 'Butter_croissant.jpg'],
  'Kartoffelbrei': ['Mashed_potato_(13).jpg', 'Mashed_potatoes.jpg', 'Kartoffelp%C3%BCree.jpg'],
  'Kartoffelpüree': ['Mashed_potato_(13).jpg', 'Mashed_potatoes.jpg', 'Kartoffelp%C3%BCree.jpg'],
  'Bratkartoffeln': ['Bratkartoffeln_in_einer_Pfanne.jpg', 'Bratkartoffeln.jpg', 'Pan-fried_potatoes.jpg'],
  'Pommes': ['French_Fries_with_Trans_Fat.jpg', 'Pommes_frites.jpg', 'French_Fries.jpg'],
  'Pommes frites': ['French_Fries_with_Trans_Fat.jpg', 'Pommes_frites.jpg', 'French_Fries.jpg'],
  'Reis': ['Rice_p1160004.jpg', 'Cooked_rice.jpg', 'White_rice.jpg'],
  'Bratwurst': ['Bratwurst_grill_2.jpg', 'Bratwurst.jpg', 'Thueringer_Rostbratwurst.jpg'],
  'Currywurst': ['Currywurst-1.jpg', 'Currywurst.jpg', 'Currywurst_mit_Pommes.jpg'],
  'Hotdog': ['NCI_Visuals_Food_Hot_Dog.jpg', 'Hot_dog.jpg', 'Hot_dog_with_mustard.jpg'],
  'Hot Dog': ['NCI_Visuals_Food_Hot_Dog.jpg', 'Hot_dog.jpg', 'Hot_dog_with_mustard.jpg'],
  'Schnitzel': ['Wienerschnitzel.JPG', 'Wiener_Schnitzel.jpg', 'Schnitzel_pommes.jpg'],
  'Wiener Schnitzel': ['Wienerschnitzel.JPG', 'Wiener_Schnitzel.jpg', 'Schnitzel_pommes.jpg'],
  'Frikadelle': ['Frikadellen_002.jpg', 'Frikadelle.jpg', 'Bouletten.jpg'],
  'Hamburger': ['NCI_Visuals_Food_Hamburger.jpg', 'Hamburger.jpg', 'Cheeseburger.jpg'],
  'Hamburger (Speise)': ['NCI_Visuals_Food_Hamburger.jpg', 'Hamburger.jpg', 'Cheeseburger.jpg'],
  'Sauerkraut': ['Sauerkraut.jpg', 'Sauerkraut_2.jpg', 'Choucroute.jpg'],
  'Knödel': ['Semmelkn%C3%B6del_03.jpg', 'Kn%C3%B6del.jpg', 'Semmelknoedel.jpg'],
  'Kloß': ['Semmelkn%C3%B6del_03.jpg', 'Kn%C3%B6del.jpg', 'Semmelknoedel.jpg'],
  'Suppe': ['Tomato_soup_in_red_bowl.jpg', 'Tomato_soup.jpg', 'Bowl_of_soup.jpg'],
  'Eintopf': ['Lentil_stew.JPG', 'Eintopf.jpg', 'Stew_with_meat.jpg'],
  'Linsensuppe': ['Lentil_stew.JPG', 'Linsensuppe.jpg', 'Lentil_soup.jpg'],
  'Salat (Speise)': ['Salad_platter.jpg', 'Salat_speise.jpg', 'Mixed_salad.jpg'],
  'Kuchen': ['Layer_cake_with_white_chocolate_butter_cream.jpg', 'Kuchen.jpg', 'Cake_with_strawberries.jpg'],
  'Apfelkuchen': ['Apple_cake.jpg', 'Apfelkuchen.jpg', 'Apfelkuchen_2.jpg'],
  'Apfelstrudel': ['Apfelstrudel_-_Czech_Republic.jpg', 'Apfelstrudel.jpg', 'Apple_strudel.jpg'],
  'Käsekuchen': ['NewYorkCheesecake.JPG', 'Cheesecake.jpg', 'K%C3%A4sekuchen.jpg'],
  'Schwarzwälder Kirschtorte': ['Black_Forest_gateau_made_with_morello_cherries.JPG', 'Schwarzw%C3%A4lder_Kirschtorte.jpg', 'Black_Forest_cake.jpg'],
  'Eis': ['Ice_cream_dessert_02.jpg', 'Ice_cream_(2).jpg', 'Speiseeis.jpg'],
  'Speiseeis': ['Ice_cream_dessert_02.jpg', 'Ice_cream_(2).jpg', 'Speiseeis.jpg'],
  'Spiegelei': ['Spiegelei.jpg', 'Sunny_side_up_egg.jpg', 'Fried_egg_2.jpg'],
  'Käse': ['Cheese_2_bg_040917.jpg', 'Cheese_platter.jpg', 'Various_cheeses.jpg'],
  'Butter': ['NCI_butter.jpg', 'Butter.jpg', 'Butter_block.jpg'],
  'Joghurt': ['Plain_Yogurt.jpg', 'Yogurt.jpg', 'Yoghurt_(1).jpg'],
  'Quark': ['Skyr_dish.jpg', 'Quark.jpg', 'Quark_cheese.jpg'],
  'Quark (Milchprodukt)': ['Skyr_dish.jpg', 'Quark.jpg', 'Quark_cheese.jpg'],
  'Pfannkuchen': ['Crepes_dsc07085.jpg', 'Pfannkuchen.jpg', 'Pancake.jpg'],
  'Spätzle': ['Sp%C3%A4tzle.jpg', 'Spaetzle.jpg', 'Schwabenspaetzle.jpg'],
  'Maultaschen': ['Maultaschen-1.jpg', 'Maultaschen.jpg', 'Maultaschen_in_Br%C3%BChe.jpg'],
  'Maultasche': ['Maultaschen-1.jpg', 'Maultaschen.jpg', 'Maultaschen_in_Br%C3%BChe.jpg'],
  'Müsli': ['M%C3%BCsli_in_a_bowl.jpg', 'Muesli.jpg', 'Cereal_with_milk.jpg'],
  'Schokolade': ['Chocolate.jpg', 'Chocolate_bar.jpg', 'Schokolade.jpg'],
  'Honig': ['Honey_comb.jpg', 'Honey_jar_on_table.jpg', 'Honey.jpg'],
  'Marmelade': ['Strawberry_jam_on_a_dish.JPG', 'Marmelade.jpg', 'Strawberry_jam.jpg'],

  // === WAHRZEICHEN ===
  'Brandenburger Tor': ['Brandenburger_Tor_abends.jpg', 'Brandenburger_Tor.jpg', 'Brandenburger_Tor_2017.jpg'],
  'Reichstagsgebäude': ['Berlin_reichstag_west_panorama_2.jpg', 'Reichstagsgeb%C3%A4ude.jpg', 'Reichstag_building_Berlin_view_from_west_before_sunset.jpg'],
  'Kölner Dom': ['Cologne_Cathedral_at_dusk.jpg', 'K%C3%B6lner_Dom_-_Vista.jpg', 'Cologne_Cathedral.jpg'],
  'Frauenkirche München': ['Frauenkirche_Munich_March_2013.JPG', 'Munich_Frauenkirche.jpg', 'Frauenkirche_Munich.jpg'],
  'Frauenkirche (München)': ['Frauenkirche_Munich_March_2013.JPG', 'Munich_Frauenkirche.jpg', 'Frauenkirche_Munich.jpg'],
  'Berliner Fernsehturm': ['Fernsehturm_Berlin_Mai_2007.jpg', 'Fernsehturm_Berlin.jpg', 'Berliner_Fernsehturm_2.jpg'],
  'Schloss Neuschwanstein': ['Schloss_Neuschwanstein_2013.jpg', 'Neuschwanstein_castle.jpg', 'Castle_Neuschwanstein.jpg'],
  'Heidelberger Schloss': ['Heidelberger_Schloss_2.jpg', 'Heidelberg_Castle.jpg', 'Heidelberger_Schloss_2018.jpg'],
  'Olympiastadion München': ['Olympiastadion_Muenchen.jpg', 'Olympiastadion_M%C3%BCnchen.jpg', 'Munich_Olympic_Stadium.jpg'],
  'Hamburger Hafen': ['Hamburg_Hafen.jpg', 'Hamburg_harbour.jpg', 'Hamburger_Hafen_-_panoramio.jpg'],
  'Wartburg': ['Wartburg_-_Sicht_aus_dem_Pfaffenholz.jpg', 'Wartburg.jpg', 'Wartburg_Eisenach.jpg'],
  'Burg Eltz': ['Burg-Eltz_2.jpg', 'Burg_Eltz_FRP.jpg', 'Burg_Eltz.jpg'],
  'Zugspitze': ['Zugspitze_mit_Wolken.jpg', 'Zugspitze_panorama.jpg', 'Zugspitze.jpg'],
  'Holstentor': ['Holstentor_in_Luebeck_-_panoramio.jpg', 'Holstentor.jpg', 'Lübeck_Holstentor.jpg'],
  'Holstentor Lübeck': ['Holstentor_in_Luebeck_-_panoramio.jpg', 'Holstentor.jpg', 'Lübeck_Holstentor.jpg'],
  'Schloss Sanssouci': ['Schloss_Sanssouci_Suedseite_Mittelpartie.jpg', 'Sanssouci.jpg', 'Schloss_Sanssouci.jpg'],
  'Eiffelturm': ['Tour_Eiffel_Wikimedia_Commons.jpg', 'Eiffel_Tower.jpg', 'Eiffel_Tower_from_north_Avenue_de_New_York%2C_Aug_2010.jpg'],
  'Notre-Dame': ['Notre_Dame_de_Paris.jpg', 'Notre-Dame_de_Paris.jpg', 'Notre_Dame_de_Paris_DSC_0846w.jpg'],
  'Notre-Dame de Paris': ['Notre_Dame_de_Paris.jpg', 'Notre-Dame_de_Paris.jpg', 'Notre_Dame_de_Paris_DSC_0846w.jpg'],
  'Sacré-Cœur': ['Le_sacre_coeur_paris.jpg', 'Sacre_coeur.jpg', 'Sacr%C3%A9-C%C5%93ur.jpg'],
  'Sacré-Cœur de Montmartre': ['Le_sacre_coeur_paris.jpg', 'Sacre_coeur.jpg', 'Sacr%C3%A9-C%C5%93ur.jpg'],
  'Triumphbogen': 'Arc_Triomphe.jpg',
  'Arc de Triomphe': 'Arc_Triomphe.jpg',
  'Schloss Versailles': ['Chateau_Versailles_Galerie_des_Glaces.jpg', 'Versailles_Palace.jpg', 'Ch%C3%A2teau_de_Versailles.jpg'],
  'Big Ben': ['Big_Ben_Clock_Face.jpg', 'Westminster_Palace_-_Feb_2007.jpg', 'Elizabeth_Tower.jpg'],
  'Elizabeth Tower': ['Big_Ben_Clock_Face.jpg', 'Westminster_Palace_-_Feb_2007.jpg', 'Elizabeth_Tower.jpg'],
  'Tower Bridge': ['Tower_Bridge_London_Twilight_-_November_2006.jpg', 'Tower_Bridge.jpg', 'Tower_bridge_London_Twilight_-_November_2006.jpg'],
  'Buckingham Palace': ['Buckingham_Palace.jpg', 'Buckingham_Palace_London.jpg', 'Buckingham_Palace_London_-_April_2009.jpg'],
  'Stonehenge': ['Stonehenge2007_07_30.jpg', 'Stonehenge_Closeup.jpg', 'Stonehenge.jpg'],
  'Kolosseum': ['Colosseo_2020.jpg', 'Colosseum_in_Rome-April_2007-1-_copie_2B.jpg', 'Colosseum.jpg'],
  'Schiefer Turm von Pisa': ['Leaning_Tower_of_Pisa.jpg', 'The_Leaning_Tower_of_Pisa_SB.jpeg', 'Tower_of_Pisa_3.jpg'],
  'Petersdom': ['Petersdom_von_Engelsburg_gesehen.jpg', 'St_Peters_Basilica.jpg', 'Basilica_di_San_Pietro.jpg'],
  'Markusplatz Venedig': ['Piazza_San_Marco.jpg', 'San_Marco_Piazza.jpg', 'Piazza_San_Marco_with_the_Basilica.jpg'],
  'Markusplatz': ['Piazza_San_Marco.jpg', 'San_Marco_Piazza.jpg', 'Piazza_San_Marco_with_the_Basilica.jpg'],
  'Trevi-Brunnen': ['Trevi_Brunnen_in_Rom.jpg', 'Trevi_Fountain%2C_Rome%2C_Italy_2_-_May_2007.jpg', 'Fontana_di_Trevi_2015.jpg'],
  'Pantheon Rom': ['Roma-pantheon-frontone.jpg', 'Pantheon_Rome.jpg', 'Rome_Pantheon_front.jpg'],
  'Pantheon (Rom)': ['Roma-pantheon-frontone.jpg', 'Pantheon_Rome.jpg', 'Rome_Pantheon_front.jpg'],
  'Akropolis': ['Athens_Acropolis.jpg', 'The_Acropolis_of_Athens_seen_from_the_Hill_of_the_Muses.jpg', 'Akropolis.jpg'],
  'Akropolis (Athen)': ['Athens_Acropolis.jpg', 'The_Acropolis_of_Athens_seen_from_the_Hill_of_the_Muses.jpg', 'Akropolis.jpg'],
  'Freiheitsstatue': ['Statue_of_Liberty_7.jpg', 'Statue_of_Liberty.jpg', 'Statue_of_Liberty_in_NY.jpg'],
  'Empire State Building': ['Empire_State_Building_from_the_Top_of_the_Rock.jpg', 'Empire_State_Building_(aerial_view).jpg', 'Empire_State_Building.jpg'],
  'Golden Gate Bridge': ['GoldenGateBridge-001.jpg', 'Golden_Gate_Bridge_2.jpg', 'GoldenGateBridge.jpg'],
  'Mount Rushmore': ['Dean_Franklin_-_06.04.03_Mount_Rushmore_Monument_(by-sa)-3_new.jpg', 'Mount_Rushmore_National_Memorial.jpg', 'Mount_Rushmore.jpg'],
  'Pyramiden von Gizeh': ['All_Gizah_Pyramids.jpg', 'Pyramids_of_Giza.jpg', 'Egypt.Giza.Sphinx.02.jpg'],
  'Sphinx von Gizeh': ['Sphinx_-_Egypt_2007.jpg', 'Egypt.Giza.Sphinx.02.jpg', 'Great_Sphinx_of_Giza.jpg'],
  'Chinesische Mauer': ['The_Great_Wall_of_China_at_Jinshanling-edit.jpg', 'GreatWall_2004_Summer_4.jpg', 'Great_Wall_of_China.jpg'],
  'Taj Mahal': ['Taj_Mahal_(Edited).jpeg', 'Taj_Mahal_in_March_2004.jpg', 'Taj_Mahal_in_India.jpg'],
  'Hagia Sophia': ['Hagia_Sophia_Mars_2013.jpg', 'Hagia_Sophia_-_Istanbul.jpg', 'Hagia_Sophia.jpg'],
  'Christusstatue Rio': ['Cristo_Redentor_Rio_de_Janeiro_4.jpg', 'Christ_the_Redeemer_-_Rio_de_Janeiro%2C_Brazil.jpg', 'Christ_the_Redeemer.jpg'],
  'Cristo Redentor': ['Cristo_Redentor_Rio_de_Janeiro_4.jpg', 'Christ_the_Redeemer_-_Rio_de_Janeiro%2C_Brazil.jpg', 'Christ_the_Redeemer.jpg'],
  'Sydney Opera House': ['Sydney_Opera_House_Sails_edit02.jpg', 'Sydney_Opera_House_Sails.jpg', 'Sydney_Opera_House_-_Dec_2008.jpg'],
  'Machu Picchu': ['80_-_Machu_Picchu_-_Juin_2009_-_edit.2.jpg', 'Machu_Picchu_early_morning.JPG', 'Machu_Picchu.jpg'],
  'Schloss Schönbrunn': ['Wien_-_Schloss_Sch%C3%B6nbrunn_(2).JPG', 'Schloss_Sch%C3%B6nbrunn_Wien_2014.jpg', 'Schloss_Schoenbrunn.jpg'],
  'Stephansdom Wien': ['Wien_St._Stephan_4.JPG', 'Stephansdom_Wien.jpg', 'Stephansdom_Vienna.jpg'],
  'Stephansdom (Wien)': ['Wien_St._Stephan_4.JPG', 'Stephansdom_Wien.jpg', 'Stephansdom_Vienna.jpg'],
  'Matterhorn': ['Matterhorn_from_Domh%C3%BCtte_-_2.jpg', 'Matterhorn_Riffelsee_2005-06-11.jpg', 'Matterhorn.jpg'],
  'Mont Blanc': ['Mont_Blanc_oct_2004.JPG', 'Mont_Blanc.jpg', 'Mont_Blanc_-_panoramio.jpg'],
  'Loreley': ['Loreley_in_Mood_Light.jpg', 'Loreley.jpg', 'Loreley_4.jpg'],
  'Marienplatz München': ['Marienplatz_Muenchen.jpg', 'Marienplatz_M%C3%BCnchen.jpg', 'Marienplatz.jpg'],
  'Marienplatz': ['Marienplatz_Muenchen.jpg', 'Marienplatz_M%C3%BCnchen.jpg', 'Marienplatz.jpg'],
  'Bremer Stadtmusikanten': ['Bremer_Stadtmusikanten.jpg', 'Bremer_Stadtmusikanten_2.jpg', 'Statue_of_the_Bremen_Town_Musicians.jpg'],

  // === Weitere Speisen ===
  'Donut': ['Donut2.jpg', 'Glazed-Donut.jpg', 'Donut.jpg'],
  'Berliner': 'Berliner_Pfannkuchen.jpg',
  'Berliner Pfannkuchen': 'Berliner_Pfannkuchen.jpg',
  'Brathähnchen': ['Roast_chicken_with_string_beans_and_tomato.jpg', 'Roast_chicken.jpg', 'Roasted_chicken.jpg'],
  'Hähnchen': ['Roast_chicken_with_string_beans_and_tomato.jpg', 'Roast_chicken.jpg', 'Roasted_chicken.jpg'],
  'Erbsensuppe': ['Pea_soup.jpg', 'Erbsensuppe.jpg', 'Split_pea_soup.jpg'],
  'Fischstäbchen': ['Fischst%C3%A4bchen-2.jpg', 'Fischstaebchen.jpg', 'Fish_fingers.jpg'],
  'Gulasch': ['Goulash_with_potato.jpg', 'Goulash.jpg', 'Gulasch.jpg'],
  'Kartoffelpuffer': ['Kartoffelpuffer.jpg', 'Reibekuchen.jpg', 'Potato_pancakes.jpg'],
  'Reibekuchen': ['Kartoffelpuffer.jpg', 'Reibekuchen.jpg', 'Potato_pancakes.jpg'],
  'Rösti': ['R%C3%B6sti.jpg', 'Rosti.jpg', 'Roesti.jpg'],
  'Kartoffelsuppe': 'Kartoffelsuppe.jpg',
  'Marmorkuchen': ['Marble_cake.jpg', 'Marmorkuchen.jpg', 'Marmorkuchen_im_Anschnitt.jpg'],
  'Sauerbraten': ['Sauerbraten.jpg', 'Rheinischer_Sauerbraten.jpg', 'Sauerbraten_mit_Kn%C3%B6deln.jpg'],
  'Leberkäse': ['Leberk%C3%A4se_001.jpg', 'Leberkaese.jpg', 'Leberk%C3%A4se.jpg'],
  'Toast (Speise)': 'Toast_-_Wikimedia_Commons.jpg',

  // === Körperteile ===
  'Hand': 'Right_hand.jpg',
  'Fuß': 'Human_foot.jpg',
  'Auge': 'Iris.right.eye.jpg',
  'Nase': 'Nose.jpg',
  'Mund': 'Lips_image.jpg',
  'Ohr': 'Ear.jpg',
  'Arm': 'Human_arm_bones_diagram.svg',
  'Bein': 'Anterior_thigh_muscles.jpg',
  'Knie': 'Human_knee.jpg',
  'Finger': 'Index_finger.jpg',
  'Schulter': 'Shoulder_joint.jpg',
  'Zahn': 'Tooth_diagram.svg',

  // === Möbel-Erweiterung ===
  'Regal': ['Bookshelf.jpg', 'Bookshelf_(2).jpg', 'Bookshelf_modern.jpg'],

  // === Werkzeuge-Erweiterung ===
  'Beil': 'Felling_axe.jpg',
  'Maßband': 'Tape_measure_yellow.jpg',
  'Schraubenschlüssel': 'Wrench_spanner.jpg',
  'Schaufel': 'Shovel.jpg',
  'Sieb': 'Sieve.jpg',
  'Mandoline': 'Mandolin.jpg',
  'Geranie': 'Pelargonium_x_hortorum.jpg',

  // === Kleidung-Erweiterung ===
  'Gürtel': 'Leather_belt.jpg',

  // === Natur-Erweiterung ===
  'Wüste': ['Erg_Chebbi_Morocco.jpg', 'Sahara_Desert.jpg', 'Saharan_Sahel-_Niger.jpg'],
  'Höhle': ['Carlsbad_Caverns.jpg', 'Cave_-_Reed_Flute_Cave.jpg', 'Postojna_cave_chandelier.jpg'],
};

const COLOR_PAIRS = [
  { light: '#fde4d3', dark: '#e8b4a4' },
  { light: '#fff2d6', dark: '#f0d089' },
  { light: '#e8f0d4', dark: '#b8d090' },
  { light: '#dde9f0', dark: '#9bb8c8' },
  { light: '#f3dde8', dark: '#d49bb0' },
  { light: '#ebe2f2', dark: '#b89bc8' },
  { light: '#fce4cc', dark: '#e6a574' },
  { light: '#dfe8e0', dark: '#94b09a' },
];
function pickColorPair(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  return COLOR_PAIRS[Math.abs(h) % COLOR_PAIRS.length];
}

function escapeXml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Bilder, die fehlen, kriegen einfach das Wort als SVG (kein Emoji)
function makeWordSvg(label) {
  const colors = pickColorPair(label);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
    <defs>
      <radialGradient id="bg" cx="50%" cy="40%" r="65%">
        <stop offset="0%" stop-color="${colors.light}"/>
        <stop offset="100%" stop-color="${colors.dark}"/>
      </radialGradient>
    </defs>
    <rect width="400" height="400" fill="url(#bg)"/>
    <text x="200" y="220" font-size="38" text-anchor="middle" font-family="Fraunces, Georgia, serif" fill="#5a4a3a" font-weight="500">${escapeXml(label)}</text>
  </svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

// Prüft, ob ein Begriff ein echtes Bild hat
function hasImage(keyword) {
  return IMAGE_FILES[keyword] !== undefined;
}
// Aliase für Kompatibilität mit altem Code
function hasEmoji(keyword) { return hasImage(keyword); }
function getEmoji(keyword) {
  const v = IMAGE_FILES[keyword];
  if (!v) return null;
  // Bei Array: ersten Eintrag als Identifier verwenden
  return Array.isArray(v) ? v[0] : v;
}

// === BILD-VERFÜGBARKEIT (lädt jedes Bild einmal vorab) ===
// imageStatus: 'unknown' | 'loading' | 'ok' | 'failed'
const imageStatus = {};

function getImageStatus(keyword) {
  return imageStatus[keyword] || 'unknown';
}

// Markiert: das Bild für diesen Begriff funktioniert wirklich (lädt im Browser)
function isImageVerified(keyword) {
  return imageStatus[keyword] === 'ok';
}

// Testet ein Bild im Browser: gibt Promise<boolean> zurück
function testImageLoad(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(false);
    }, timeoutMs);
    img.onload = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      // naturalWidth = 0 → Bild ist nicht wirklich da
      resolve(img.naturalWidth > 0);
    };
    img.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(false);
    };
    img.src = url;
  });
}

// Testet alle URLs eines Begriffs der Reihe nach. Liefert true wenn eine lädt.
async function verifyImageForKeyword(keyword) {
  const urls = getImageUrls(keyword);
  for (const url of urls) {
    const ok = await testImageLoad(url, 6000);
    if (ok) return true;
  }
  return false;
}

// Konvertiert einen einzelnen Datei-Namen zur Wikimedia-URL
function fileToUrl(file) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${file}?width=400`;
}

// Liefert ALLE Bild-URLs für einen Begriff (kann mehrere sein)
function getImageUrls(keyword) {
  const v = IMAGE_FILES[keyword];
  if (!v) return [];
  const files = Array.isArray(v) ? v : [v];
  return files.map(fileToUrl);
}

// Liefert ein Wort-SVG als sicheren Fallback (Notfall, sollte nie aufkommen)
function getWordSvg(keyword) {
  return makeWordSvg(keyword);
}

// Hauptfunktion: Begriff -> Bild-URL (erste Variante)
function getOfflineImage(keyword) {
  const urls = getImageUrls(keyword);
  if (urls.length > 0) return urls[0];
  return makeWordSvg(keyword);
}
