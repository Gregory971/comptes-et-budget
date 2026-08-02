import { describe, expect, it } from 'vitest';
import {
  applyHolidayRule, easterSunday, holidayName, holidaysOfYear, isBusinessDay,
  isWeekend, nextBusinessDay, previousBusinessDay, shiftReason,
} from './holidays';

describe('calcul de Pâques', () => {
  it('retrouve les dates connues', () => {
    // Dates de référence du calendrier grégorien.
    expect(easterSunday(2024)).toBe('2024-03-31');
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(easterSunday(2038)).toBe('2038-04-25'); // date la plus tardive possible
  });
});

describe('jours fériés légaux', () => {
  it('compte 11 jours en métropole et 12 en Guadeloupe', () => {
    // Code du travail : art. L3133-1 (11 jours nationaux)
    // + art. L3422-2 (27 mai en Guadeloupe, abolition de l'esclavage).
    expect(holidaysOfYear(2026, 'metropole').size).toBe(11);
    expect(holidaysOfYear(2026, 'guadeloupe').size).toBe(12);
  });

  it('place la commémoration au bon jour selon le territoire', () => {
    expect(holidayName('2026-05-27', 'guadeloupe')).toBe('Abolition de l’esclavage');
    expect(holidayName('2026-05-27', 'metropole')).toBeNull();
    expect(holidayName('2026-05-22', 'martinique')).toBe('Abolition de l’esclavage');
    expect(holidayName('2026-06-10', 'guyane')).toBe('Abolition de l’esclavage');
    expect(holidayName('2026-12-20', 'reunion')).toBe('Abolition de l’esclavage');
  });

  it('identifie les fêtes fixes et mobiles de 2026', () => {
    expect(holidayName('2026-01-01', 'guadeloupe')).toBe('Jour de l’An');
    expect(holidayName('2026-05-01', 'guadeloupe')).toBe('Fête du Travail');
    expect(holidayName('2026-07-14', 'guadeloupe')).toBe('Fête nationale');
    expect(holidayName('2026-12-25', 'guadeloupe')).toBe('Noël');
    expect(holidayName('2026-04-06', 'guadeloupe')).toBe('Lundi de Pâques');   // Pâques = 05/04
    expect(holidayName('2026-05-14', 'guadeloupe')).toBe('Ascension');         // Pâques + 39
    expect(holidayName('2026-05-25', 'guadeloupe')).toBe('Lundi de Pentecôte'); // Pâques + 50
  });

  it('exclut le Vendredi saint, réservé à l’Alsace-Moselle', () => {
    expect(holidayName('2026-04-03', 'guadeloupe')).toBeNull();
  });
});

describe('jours ouvrés', () => {
  it('reconnaît samedi et dimanche', () => {
    expect(isWeekend('2026-08-01')).toBe(true);  // samedi
    expect(isWeekend('2026-08-02')).toBe(true);  // dimanche
    expect(isWeekend('2026-08-03')).toBe(false); // lundi
  });

  it('exclut week-ends et jours fériés', () => {
    expect(isBusinessDay('2026-08-03', 'guadeloupe')).toBe(true);
    expect(isBusinessDay('2026-08-01', 'guadeloupe')).toBe(false);
    expect(isBusinessDay('2026-05-27', 'guadeloupe')).toBe(false);
    expect(isBusinessDay('2026-05-27', 'metropole')).toBe(true);
  });

  it('trouve le jour ouvré suivant et précédent', () => {
    expect(nextBusinessDay('2026-08-01')).toBe('2026-08-03');       // samedi → lundi
    expect(previousBusinessDay('2026-08-02')).toBe('2026-07-31');   // dimanche → vendredi
    // 15 août 2026 = samedi ET Assomption → lundi 17
    expect(nextBusinessDay('2026-08-15', 'guadeloupe')).toBe('2026-08-17');
  });
});

describe('règle de report des échéances', () => {
  it('reporte au jour ouvrable suivant', () => {
    expect(applyHolidayRule('2026-08-01', 'suivant')).toBe('2026-08-03');
    expect(applyHolidayRule('2026-12-25', 'suivant', 'guadeloupe')).toBe('2026-12-28');
  });

  it('reporte au jour ouvrable précédent', () => {
    expect(applyHolidayRule('2026-08-01', 'precedent')).toBe('2026-07-31');
    expect(applyHolidayRule('2026-12-25', 'precedent', 'guadeloupe')).toBe('2026-12-24');
  });

  it('conserve la date exacte si la règle le demande', () => {
    expect(applyHolidayRule('2026-08-01', 'exacte')).toBe('2026-08-01');
    expect(applyHolidayRule('2026-05-27', 'exacte', 'guadeloupe')).toBe('2026-05-27');
  });

  it('ne modifie pas une date déjà ouvrée', () => {
    expect(applyHolidayRule('2026-08-03', 'suivant', 'guadeloupe')).toBe('2026-08-03');
    expect(shiftReason('2026-08-03', 'guadeloupe')).toBeNull();
  });

  it('distingue le 27 mai selon le territoire', () => {
    // Mercredi 27 mai 2026 : férié en Guadeloupe, ouvré en métropole.
    expect(applyHolidayRule('2026-05-27', 'suivant', 'guadeloupe')).toBe('2026-05-28');
    expect(applyHolidayRule('2026-05-27', 'suivant', 'metropole')).toBe('2026-05-27');
  });

  it('explique le motif du report', () => {
    expect(shiftReason('2026-12-25', 'guadeloupe')).toBe('Noël');
    expect(shiftReason('2026-08-01')).toBe('samedi');
    expect(shiftReason('2026-08-02')).toBe('dimanche');
  });
});
