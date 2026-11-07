import { Button, Icon, Search, Toggle, type SubIcon } from '@vibe/core';
import {
  Bolt,
  Calendar,
  Comment,
  Favorite,
  Integrations,
  Mirror,
  NavigationChevronRight,
  Search as SearchIcon,
} from '@vibe/icons';
import { useMemo, useState } from 'react';
import type { AutomationInput } from '../../data/automations';
import { EmptyState } from '../EmptyState/EmptyState';
import { NoSearchResults } from '../illustrations';
import {
  basicsTemplates,
  buildTemplateInput,
  plainSentence,
  TEMPLATE_CATALOG,
  TEMPLATE_CATEGORIES,
  templatesByCategory,
  type CatalogTemplate,
  type StarterBoard,
  type TemplateCategory,
} from './starter-recipes';
import { TemplateCard } from './TemplateCard';
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

const NAV_ICONS: Record<Section, SubIcon> = {
  explore: SearchIcon,
  recommended: Favorite,
  productivity: Bolt,
  communication: Comment,
  dates: Calendar,
  connected: Mirror,
  sync: Integrations,
};

/** How many cards each Explore section shows before "Show more". */
const EXPLORE_COUNT = 4;

const templatesLabel = (n: number) => `${n} ${n === 1 ? 'template' : 'templates'}`;

/** "Status, Priority and Approve": a list in words. */
function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

interface Block {
  key: string;
  title: string;
  meta?: string;
  /** Category the "Show more" link opens. */
  more?: Section;
  templates: CatalogTemplate[];
  /** Explore sections have exactly four columns; the others fill the width. */
  fixed: boolean;
  recommended?: boolean;
}

/** The Create half of the Automation center: browse the catalog and start from a template. */
export function CreateTab({ board, uid, isOwner, onOpenBuilder }: CreateTabProps) {
  const [section, setSection] = useState<Section>('explore');
  const [term, setTerm] = useState('');
  const [hideSoon, setHideSoon] = useState(false);
  const [noFit, setNoFit] = useState<string | null>(null);

  const query = term.trim();
  const searching = query.length > 0;

  const categoryLabel = (id: TemplateCategory) =>
    TEMPLATE_CATEGORIES.find((c) => c.id === id)?.label ?? id;

  const readyCount = TEMPLATE_CATALOG.filter((t) => t.availability === 'ready').length;

  /** Categories whose templates are all unavailable get a "Planned" tag. */
  const plannedCategories = useMemo(
    () =>
      new Set(
        TEMPLATE_CATEGORIES.filter((c) =>
          templatesByCategory(c.id).every((t) => t.availability !== 'ready'),
        ).map((c) => c.id),
      ),
    [],
  );

  const recommendedLine = useMemo(() => {
    const titles = board.columns
      .filter((c) => c.type === 'status' || c.type === 'people' || c.type === 'button')
      .map((c) => c.title.trim())
      .filter(Boolean);
    const unique = [...new Set(titles)];
    return unique.length > 0
      ? `Templates for the columns this board already has: ${joinWords(unique)}.`
      : null;
  }, [board.columns]);

  const { blocks, hiddenBySwitch } = useMemo(() => {
    const lower = query.toLowerCase();
    const matches = (t: CatalogTemplate) =>
      !lower || plainSentence(t).toLowerCase().includes(lower);
    const shown = (t: CatalogTemplate) => matches(t) && (!hideSoon || t.availability === 'ready');

    if (searching) {
      const found = TEMPLATE_CATALOG.filter(shown);
      return {
        hiddenBySwitch: hideSoon && TEMPLATE_CATALOG.some(matches),
        blocks: found.length
          ? [
              {
                key: 'results',
                title: `Results for “${query}”`,
                meta: `· ${templatesLabel(found.length)}`,
                templates: found,
                fixed: false,
              } satisfies Block,
            ]
          : [],
      };
    }

    if (section === 'explore') {
      const basics = basicsTemplates();
      const basicIds = new Set(basics.map((t) => t.id));
      const recommended = templatesByCategory('recommended').filter(shown);
      const recommendedShown = recommended
        .filter((t) => !basicIds.has(t.id))
        .slice(0, EXPLORE_COUNT);
      const productivity = templatesByCategory('productivity')
        .filter(shown)
        .filter((t) => !t.recommended);
      const out: Block[] = [
        {
          key: 'recommended',
          title: 'Recommended',
          meta: `· ${templatesLabel(recommended.length)}`,
          more: 'recommended',
          templates: recommendedShown,
          fixed: true,
          recommended: true,
        },
        {
          key: 'productivity',
          title: 'Productivity',
          meta: `· ${templatesLabel(productivity.length)}`,
          more: 'productivity',
          templates: productivity.slice(0, EXPLORE_COUNT),
          fixed: true,
        },
      ];
      return { hiddenBySwitch: false, blocks: out.filter((b) => b.templates.length > 0) };
    }

    const all = templatesByCategory(section);
    const visible = all.filter(shown);
    return {
      hiddenBySwitch: hideSoon && visible.length === 0 && all.length > 0,
      blocks: visible.length
        ? [
            {
              key: section,
              title: categoryLabel(section),
              meta: `· ${templatesLabel(visible.length)}`,
              templates: visible,
              fixed: false,
            } satisfies Block,
          ]
        : [],
    };
  }, [section, hideSoon, query, searching]);

  const showBasics = section === 'explore' && !searching;
  const isEmpty = blocks.length === 0 && !showBasics;

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

  const renderCards = (templates: CatalogTemplate[], fixed: boolean, keyPrefix: string) => (
    <ul className={styles.grid} data-fixed={fixed || undefined}>
      {templates.map((t) => (
        <TemplateCard
          key={`${keyPrefix}-${t.id}`}
          template={t}
          isOwner={isOwner}
          noFit={noFit === t.id}
          onUse={use}
        />
      ))}
    </ul>
  );

  const heading = (id: string, block: Pick<Block, 'title' | 'meta' | 'more'>) => (
    <div className={styles.sectionHead}>
      <h3 id={id} className={styles.sectionTitle}>
        {block.title}
      </h3>
      {block.meta ? <span className={styles.sectionMeta}>{block.meta}</span> : null}
      {block.more ? (
        <button
          type="button"
          className={styles.more}
          aria-label={`Show more ${block.title} templates`}
          onClick={() => setSection(block.more!)}
        >
          Show more
          <Icon icon={NavigationChevronRight} size={14} />
        </button>
      ) : null}
    </div>
  );

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <nav className={styles.nav} aria-label="Categories">
          <h3 className={styles.sidebarTitle}>Categories</h3>
          <ul className={styles.navList}>
            {navItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={styles.navItem}
                  aria-current={!searching && section === item.id ? 'true' : undefined}
                  onClick={() => {
                    setSection(item.id);
                    setTerm('');
                  }}
                >
                  <span className={styles.navIcon} aria-hidden="true">
                    <Icon icon={NAV_ICONS[item.id]} size={18} />
                  </span>
                  <span className={styles.navLabel}>{item.label}</span>
                  {item.id !== 'explore' && plannedCategories.has(item.id as TemplateCategory) ? (
                    <span className={styles.plannedTag}>Planned</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.sidebarFooter}>
          <div className={styles.switchRow}>
            <span className={styles.switchLabel}>Hide coming soon</span>
            <Toggle
              isSelected={hideSoon}
              onChange={setHideSoon}
              aria-label="Hide coming soon"
              areLabelsHidden
            />
          </div>
          <p className={styles.footnote}>
            {readyCount} of {TEMPLATE_CATALOG.length} templates work today.
          </p>
          <Button
            kind="secondary"
            size="small"
            className={styles.integrationsButton}
            leftIcon={Integrations}
            disabled
          >
            Integrations · Coming soon
          </Button>
          <p className={styles.footnote}>Email, calendar and chat apps arrive with P9.</p>
        </div>
      </aside>
      <div className={styles.main}>
        <div className={styles.toolbar}>
          <div className={styles.search}>
            <Search
              value={term}
              onChange={setTerm}
              placeholder="Search templates"
              inputAriaLabel="Search templates"
              size="medium"
            />
          </div>
        </div>
        {!isOwner ? (
          <p className={styles.banner} role="note">
            Only board owners can use templates. You can browse them here.
          </p>
        ) : null}
        {!searching && section === 'sync' ? (
          <p className={styles.banner} role="note">
            <Icon icon={Integrations} size={18} />
            <span>
              <strong>Integrations are planned (P9).</strong> Atrium can&apos;t connect to email,
              calendar or chat apps yet, so these templates are a preview and can&apos;t be used.
            </span>
          </p>
        ) : null}
        {showBasics ? (
          <section className={styles.section} aria-labelledby="create-basics">
            {heading('create-basics', { title: 'Start with the basics' })}
            <ul className={styles.grid} data-fixed>
              <li className={styles.scratchItem}>
                <button
                  type="button"
                  className={styles.scratch}
                  disabled={!isOwner}
                  onClick={() => onOpenBuilder()}
                >
                  <span className={styles.scratchPlus} aria-hidden="true">
                    +
                  </span>
                  <span className={styles.scratchTitle}>Create from scratch</span>
                  <span className={styles.scratchHint}>
                    Write your own “When …, then …” sentence
                  </span>
                </button>
              </li>
              {basicsTemplates().map((t) => (
                <TemplateCard
                  key={`basics-${t.id}`}
                  template={t}
                  isOwner={isOwner}
                  noFit={noFit === t.id}
                  onUse={use}
                />
              ))}
            </ul>
          </section>
        ) : null}
        {blocks.map((block) => (
          <section
            key={block.key}
            className={styles.section}
            aria-labelledby={`create-${block.key}`}
          >
            {heading(`create-${block.key}`, block)}
            {block.recommended && recommendedLine ? (
              <p className={styles.subLine}>{recommendedLine}</p>
            ) : null}
            {block.recommended && !hideSoon ? (
              <ul className={styles.integrations} aria-label="Integrations, coming soon">
                {[
                  { label: 'Email', icon: Integrations },
                  { label: 'Calendar', icon: Calendar },
                  { label: 'Team chat', icon: Comment },
                ].map((tile) => (
                  <li key={tile.label} className={styles.integration}>
                    <Icon icon={tile.icon} size={18} />
                    <span className={styles.integrationText}>
                      <span className={styles.integrationName}>{tile.label}</span>
                      <span className={styles.integrationSoon}>Coming soon</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {renderCards(block.templates, block.fixed, block.key)}
          </section>
        ))}
        {isEmpty ? (
          hiddenBySwitch ? (
            <EmptyState size="panel" title="Nothing here with “Hide coming soon” on" />
          ) : (
            <EmptyState
              size="panel"
              illustration={<NoSearchResults />}
              title={`No templates match “${query}”`}
              body="Try “status”, “notify” or “group”, or write the automation yourself."
              secondaryAction={{
                label: 'Clear search',
                variant: 'button',
                onClick: () => setTerm(''),
              }}
              primaryAction={{
                label: 'Create from scratch',
                disabled: !isOwner,
                onClick: () => onOpenBuilder(),
              }}
            />
          )
        ) : null}
      </div>
    </div>
  );
}
