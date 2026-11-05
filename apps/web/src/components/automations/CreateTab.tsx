import { Button, Label, Search, Toggle } from '@vibe/core';
import { Add } from '@vibe/icons';
import { Fragment, useMemo, useState } from 'react';
import type { AutomationInput } from '../../data/automations';
import {
  AVAILABILITY_LABELS,
  buildStarterRecipes,
  buildTemplateInput,
  plainSentence,
  TEMPLATE_CATALOG,
  TEMPLATE_CATEGORIES,
  templatesByCategory,
  type CatalogTemplate,
  type StarterBoard,
  type TemplateCategory,
} from './starter-recipes';
import styles from './CreateTab.module.css';

type Section = 'explore' | TemplateCategory;

export interface CreateTabProps {
  board: StarterBoard;
  uid: string;
  /** Only board owners can start a recipe; everyone else browses the catalog read-only. */
  isOwner: boolean;
  /** Opens the recipe builder, blank or prefilled. */
  onOpenBuilder: (initial?: AutomationInput) => void;
}

/** The sentence with the asterisked words in bold. */
function Sentence({ sentence }: { sentence: string }) {
  return (
    <p className={styles.sentence}>
      {sentence.split('*').map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className={styles.key}>
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

const SECTION_ORDER: TemplateCategory[] = TEMPLATE_CATEGORIES.map((c) => c.id);

/** The Create half of the Automation center: browse the catalog and start from a template. */
export function CreateTab({ board, uid, isOwner, onOpenBuilder }: CreateTabProps) {
  const [section, setSection] = useState<Section>('explore');
  const [term, setTerm] = useState('');
  const [hideSoon, setHideSoon] = useState(false);
  const [noFit, setNoFit] = useState<string | null>(null);

  const starters = useMemo(
    () => (isOwner ? buildStarterRecipes(board, uid) : []),
    [board, isOwner, uid],
  );

  const sections = useMemo(() => {
    const query = term.trim().toLowerCase();
    const visible = (t: CatalogTemplate) =>
      (!hideSoon || t.availability === 'ready') &&
      (!query || plainSentence(t).toLowerCase().includes(query));
    const ids = section === 'explore' ? SECTION_ORDER : [section];
    return ids
      .map((id) => ({
        id,
        label: TEMPLATE_CATEGORIES.find((c) => c.id === id)?.label ?? id,
        templates: templatesByCategory(id, TEMPLATE_CATALOG).filter(visible),
      }))
      .filter((s) => s.templates.length > 0);
  }, [section, hideSoon, term]);

  const showBasics = section === 'explore' && !term.trim();

  const use = (template: CatalogTemplate) => {
    const input = buildTemplateInput(template, board, uid);
    if (!input) {
      setNoFit(template.id);
      return;
    }
    setNoFit(null);
    onOpenBuilder(input);
  };

  const navItems: { id: Section; label: string }[] = [
    { id: 'explore', label: 'Explore' },
    ...TEMPLATE_CATEGORIES.map((c) => ({ id: c.id as Section, label: c.label })),
  ];

  return (
    <div className={styles.layout}>
      <nav className={styles.sidebar} aria-label="Categories">
        <h3 className={styles.sidebarTitle}>Categories</h3>
        <ul className={styles.navList}>
          {navItems.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={styles.navItem}
                aria-current={section === item.id ? 'true' : undefined}
                onClick={() => setSection(item.id)}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.main}>
        <div className={styles.toolbar}>
          <div className={styles.search}>
            <Search
              value={term}
              onChange={setTerm}
              placeholder="Search templates"
              inputAriaLabel="Search templates"
              size="small"
            />
          </div>
          <Toggle
            isSelected={hideSoon}
            onChange={setHideSoon}
            aria-label="Hide coming soon"
            areLabelsHidden
          />
          <span className={styles.toggleLabel} aria-hidden="true">
            Hide coming soon
          </span>
        </div>
        {!isOwner ? (
          <p className={styles.note} role="note">
            Only board owners can use templates. You can browse them here.
          </p>
        ) : null}
        {showBasics ? (
          <section className={styles.section} aria-labelledby="create-basics">
            <h3 id="create-basics" className={styles.sectionTitle}>
              Start with the basics
            </h3>
            <ul className={styles.grid}>
              <li className={styles.card}>
                <p className={styles.sentence}>
                  <strong className={styles.key}>Create from scratch</strong>
                </p>
                <p className={styles.hint}>Pick a trigger, conditions and actions yourself.</p>
                <Button
                  kind="secondary"
                  size="small"
                  leftIcon={Add}
                  disabled={!isOwner}
                  onClick={() => onOpenBuilder()}
                >
                  Create from scratch
                </Button>
              </li>
              {starters.map((starter) => (
                <li key={starter.id} className={styles.card}>
                  <Sentence sentence={starter.title} />
                  <p className={styles.hint}>{starter.description}</p>
                  <Button
                    kind="secondary"
                    size="small"
                    aria-label={`Use template: ${starter.title}`}
                    onClick={() => onOpenBuilder(starter.input)}
                  >
                    Use template
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {sections.map((s) => (
          <section key={s.id} className={styles.section} aria-labelledby={`create-${s.id}`}>
            <h3 id={`create-${s.id}`} className={styles.sectionTitle}>
              {s.label}
            </h3>
            <ul className={styles.grid}>
              {s.templates.map((t) => (
                <li
                  key={`${s.id}-${t.id}`}
                  className={styles.card}
                  data-unavailable={t.availability !== 'ready' || undefined}
                >
                  {t.availability !== 'ready' ? (
                    <Label text={AVAILABILITY_LABELS[t.availability]} kind="line" />
                  ) : null}
                  <Sentence sentence={t.sentence} />
                  {noFit === t.id ? (
                    <p className={styles.noFit} role="status">
                      This board has no column or group that fits this template.
                    </p>
                  ) : null}
                  <Button
                    kind="secondary"
                    size="small"
                    disabled={t.availability !== 'ready' || !isOwner}
                    aria-label={`Use template: ${plainSentence(t)}`}
                    onClick={() => use(t)}
                  >
                    Use template
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {sections.length === 0 && !showBasics ? (
          <p className={styles.empty}>No templates match.</p>
        ) : null}
      </div>
    </div>
  );
}
