// Seed texts, so the app does something interesting before you've pasted
// anything. All of these are written for this project — no third-party text is
// bundled — and each one is a deliberately different register, because a
// cut-up is only as good as the friction between its sources.

export const SEED_TEXTS = [
  {
    id: 'harbour-report',
    lang: 'en',
    label: 'Newspaper report',
    text: `The harbour authority confirmed on Tuesday that the northern dock will
close for eleven weeks while engineers replace the sea gate. Freight will be
diverted along the coast road, adding forty minutes to every crossing. Local
traders say the timing could not be worse. A spokesperson for the port said the
old gate had been leaking since the winter storms and that repairs could no
longer be postponed. Residents on the quay reported hearing the alarm at four in
the morning. Nobody was injured. The council has promised compensation for the
fishing fleet, though the amount has not been agreed. Inspectors will return in
March. Until then the cranes stand idle above the water, and the ferry timetable
is printed on a sheet of paper taped to the terminal window.`,
  },
  {
    id: 'field-notes',
    lang: 'en',
    label: 'Field notes',
    text: `Morning fog on the estuary, thick enough to swallow the far bank. The
tide goes out and leaves the mud shining like poured metal. Gulls work the
shoreline in slow circles. There is a smell of salt and diesel from the boatyard,
and under that, faintly, something green and rotting. A heron stands in the
channel without moving for twenty minutes. When it finally lifts, the whole body
seems to unfold. Wind from the north-east, steady. The grass on the bank has been
flattened in one direction, all of it, like a hand was drawn across the field.
Later the sun burns through and the water turns hard and bright. Three cormorants
on a broken post. The light does not last.`,
  },
  {
    id: 'manual',
    lang: 'en',
    label: 'Technical manual',
    text: `Before operating the unit, verify that the supply voltage matches the
rating plate. Disconnect power at the isolator and wait sixty seconds for the
capacitors to discharge. Remove the four retaining screws from the housing. The
filament assembly is held under spring tension; support it with one hand while
releasing the clamp. Do not touch the glass with bare fingers. Inspect the seal
for cracking, discoloration or salt deposits. Replace any component that shows
heat damage. When reassembling, tighten diagonally and evenly to avoid distorting
the flange. The indicator will flash amber during the self test and settle to a
steady green when the circuit is stable. If the fault light persists, log the
error code and contact the service department. Keep this manual with the
equipment.`,
  },
  {
    id: 'havenbericht',
    lang: 'nl',
    label: 'Krantenbericht',
    text: `De gemeente maakte dinsdag bekend dat de brug over het kanaal drie
maanden dicht gaat voor groot onderhoud. Het verkeer wordt omgeleid via de
Ringweg, wat in de spits zeker een half uur extra kost. Ondernemers in de
binnenstad vrezen omzetverlies. Volgens een woordvoerder is het staal van de
klep zwaarder aangetast dan gedacht en kan uitstel niet langer. Bewoners aan de
kade klaagden vorige week al over trillingen en het geluid van de heimachine,
soms tot laat in de avond. Er vielen geen gewonden. De aannemer belooft dat de
fietsroute langs het water open blijft. Wanneer de nieuwe klep precies geplaatst
wordt, is nog onduidelijk. Tot die tijd staan de kranen stil boven het water en
hangt de omleiding op een geplastificeerd vel aan het hek.`,
  },
  {
    id: 'veldnotities',
    lang: 'nl',
    label: 'Veldnotities',
    text: `Ochtendmist boven de polder, dik genoeg om de dijk te laten verdwijnen.
Het water in de sloot staat hoog en zwart. Een reiger staat roerloos in de
berm, twintig minuten lang, en klapt dan open als een oude paraplu. Het ruikt
naar natte klei en diesel van de weg. De wind komt uit het noordoosten en blijft
de hele dag hetzelfde. Het riet ligt in één richting plat, alsof er een hand
overheen is gegaan. Later breekt de zon door en wordt het water hard en fel.
Drie meeuwen op een gebroken paal. Ergens achter de bomen begint een tractor.
Om vier uur trekt de mist weer dicht en is de overkant verdwenen, en het licht
houdt nooit lang stand.`,
  },
  {
    id: 'handleiding',
    lang: 'nl',
    label: 'Handleiding',
    text: `Controleer voor gebruik of de netspanning overeenkomt met het
typeplaatje. Schakel de installatie uit bij de werkschakelaar en wacht zestig
seconden tot de condensatoren ontladen zijn. Verwijder de vier schroeven uit de
behuizing. Het binnenwerk staat onder veerspanning; ondersteun het met één hand
terwijl u de klem losmaakt. Raak het glas niet aan met blote vingers. Inspecteer
de afdichting op scheuren, verkleuring en zoutaanslag. Vervang elk onderdeel dat
sporen van hitte vertoont. Draai bij montage kruislings en gelijkmatig aan, zodat
de flens niet vervormt. Tijdens de zelftest knippert het lampje oranje en gaat
daarna over in een rustig groen. Blijft de storingsmelding staan, noteer dan de
foutcode en neem contact op met de servicedienst. Bewaar deze handleiding bij het
apparaat.`,
  },
];

/** Seed texts for one language. */
export function seedsFor(lang) {
  return SEED_TEXTS.filter((s) => s.lang === lang);
}

/** Looks up a seed text by id. */
export function seedById(id) {
  return SEED_TEXTS.find((s) => s.id === id);
}
