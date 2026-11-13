# MENU

All prices are in US dollars and include tax. Bunzo sells only these items.

## Burgers (category id: burgers)
- classic: Bunzo Classic. $5.49. Modifiers: extra_cheese, add_bacon, extra_patty, add_jalapenos, no_onions, no_pickles, no_tomato, no_lettuce, no_cheese, no_sauce. Combo: yes. About: Flame-grilled beef patty, cheddar, lettuce, tomato, pickles and Bunzo sauce on a toasted brioche bun. 590 cal.
- double_stack: Double Stack. $7.29. Modifiers: extra_cheese, add_bacon, extra_patty, add_jalapenos, no_onions, no_pickles, no_tomato, no_lettuce, no_cheese, no_sauce. Combo: yes. About: Two smashed beef patties, double cheddar, grilled onions, pickles and Bunzo sauce. 860 cal.
- smokehouse_bbq: Smokehouse BBQ Bacon. $7.99. Modifiers: extra_cheese, extra_patty, add_jalapenos, no_onions, no_cheese, no_sauce. Combo: yes. About: Beef patty, smoked bacon, crispy onion rings, cheddar and smoky BBQ sauce. 920 cal.
- crispy_chicken: Crispy Chicken Sandwich. $6.49. Modifiers: extra_cheese, add_bacon, add_jalapenos, add_avocado, no_pickles, no_lettuce, no_sauce. Combo: yes. About: Buttermilk fried chicken breast, shredded lettuce, pickles and creamy mayo. 680 cal.
- firecracker_chicken: Firecracker Chicken. $6.79. Modifiers: extra_cheese, add_bacon, add_avocado, no_cheese, no_lettuce, no_sauce. Combo: yes. About: Spicy fried chicken, jalapeños, pepper jack and chipotle mayo. It bites back. 720 cal.
- garden_veggie: Garden Veggie Burger. $6.29. Modifiers: extra_cheese, add_avocado, add_jalapenos, no_onions, no_tomato, no_lettuce, no_sauce. Combo: yes. About: Plant-based patty, lettuce, tomato, red onion and avocado spread. 540 cal.

## Chicken & Dogs (category id: chicken)
- chicken_bites: Chicken Bites. 6_piece $4.99, 9_piece $6.49, 12_piece $7.99. Needs choice (dip): bbq, honey_mustard, ranch, sweet_chili, buffalo. Modifiers: extra_dip. Combo: yes. About: Golden, juicy all-white-meat bites with a dip of your choice. 290 cal.
- bunzo_dog: Bunzo Dog. $3.99. Modifiers: add_chili, extra_cheese, no_onions. Combo: yes. About: All-beef hot dog in a toasted bun with mustard, ketchup and relish. 420 cal.

## Sides (category id: sides)
- fries: Golden Fries. small $2.29, medium $2.99, large $3.59. Modifiers: make_it_loaded, extra_dip. Combo: no. About: Crispy outside, fluffy inside, salted just right. 320 cal.
- onion_rings: Onion Rings. regular $3.29, large $4.29. Modifiers: extra_dip. Combo: no. About: Thick-cut sweet onions in a crunchy golden batter. 410 cal.

## Shakes & Treats (category id: treats)
- shake: Hand-Spun Shake. regular $3.99, large $4.99. Needs choice (flavor): vanilla, chocolate, strawberry, cookies_and_cream. Modifiers: cookie_crumble, no_whip. Combo: no. About: Thick, creamy and hand-spun, topped with whipped cream. 560 cal.
- soft_serve: Soft-Serve Cone. $1.79. Needs choice (flavor): vanilla, chocolate, swirl. Combo: no. About: Silky soft-serve in a crisp waffle cone. 230 cal.
- apple_pie: Warm Apple Pie. $1.99. Combo: no. About: Flaky golden crust with cinnamon apple filling, served warm. 250 cal.
- cookie: Choc Chip Cookie. $1.29. Combo: no. About: Soft-baked with big chocolate chunks. 210 cal.

## Drinks (category id: drinks)
- fountain_drink: Fountain Drink. kids $1.49, regular $1.99, large $2.49. Needs choice (flavor): cola, zero_cola, lemon_lime, orange_fizz, root_beer. Modifiers: light_ice, no_ice. Combo: no. About: Ice-cold and bubbly. Bunzo Cola, Zero Cola, Lemon-Lime, Orange Fizz or Root Beer. 210 cal.
- lemonade: Fresh Lemonade. regular $2.49, large $2.99. Needs choice (flavor): classic, strawberry. Modifiers: light_ice, no_ice. Combo: no. About: Squeezed fresh every morning. Classic or strawberry. 180 cal.
- water: Bottled Water. $1.49. Combo: no. About: Still spring water, chilled. 0 cal.

## Choice option names
- fountain_flavors: cola = Bunzo Cola, zero_cola = Zero Cola, lemon_lime = Lemon-Lime, orange_fizz = Orange Fizz, root_beer = Root Beer
- dips: bbq = Smoky BBQ, honey_mustard = Honey Mustard, ranch = Ranch, sweet_chili = Sweet Chili, buffalo = Buffalo
- shake_flavors: vanilla = Vanilla, chocolate = Chocolate, strawberry = Strawberry, cookies_and_cream = Cookies & Cream
- cone_flavors: vanilla = Vanilla, chocolate = Chocolate, swirl = Swirl
- lemonade_flavors: classic = Classic, strawberry = Strawberry

## Modifiers (price added per item)
- extra_cheese: Extra cheese, +$0.80
- add_bacon: Add bacon, +$1.50
- extra_patty: Extra patty, +$2.00
- add_jalapenos: Add jalapeños, +$0.50
- add_avocado: Add avocado, +$1.00
- add_chili: Add chili, +$0.99
- make_it_loaded: Make it loaded, +$1.99
- extra_dip: Extra dip, +$0.50
- cookie_crumble: Cookie crumble, +$0.50
- no_onions: No onions, free
- no_pickles: No pickles, free
- no_tomato: No tomato, free
- no_lettuce: No lettuce, free
- no_cheese: No cheese, free
- no_sauce: No sauce, free
- no_whip: No whipped cream, free
- light_ice: Light ice, free
- no_ice: No ice, free

## Combos
- regular: +$3.49, adds Medium Golden Fries and a regular Fountain Drink.
- large: +$4.49, adds Large Golden Fries and a large Fountain Drink.
- Every combo needs a combo_drink, one of the fountain_flavors ids.

## Line price
(size price or item price) + (each modifier price) + (combo price), then times quantity. A choice (flavor, dip) and a combo_drink never change the price.
